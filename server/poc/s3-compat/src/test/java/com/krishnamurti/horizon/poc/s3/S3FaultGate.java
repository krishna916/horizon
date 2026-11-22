package com.krishnamurti.horizon.poc.s3;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** One-request TCP gate used to expose upload-byte and successful-response barriers in tests. */
final class S3FaultGate implements AutoCloseable {

    enum Mode { INTERRUPT_AFTER_BODY, HOLD_AFTER_BODY, DROP_AFTER_SUCCESS }

    private static final int BODY_BARRIER_BYTES = 64 * 1024;
    private final Mode mode;
    private final ServerSocket listener;
    private final CountDownLatch bodyBarrier = new CountDownLatch(1);
    private final CountDownLatch releaseBody = new CountDownLatch(1);
    private final CountDownLatch serverSuccess = new CountDownLatch(1);
    private final AtomicReference<IOException> failure = new AtomicReference<>();
    private final CompletableFuture<Void> handled;

    S3FaultGate(Mode mode) throws IOException {
        this.mode = mode;
        listener = new ServerSocket();
        listener.bind(new InetSocketAddress("127.0.0.1", 0));
        handled = CompletableFuture.runAsync(this::handle);
    }

    URI endpoint() {
        return URI.create("http://127.0.0.1:" + listener.getLocalPort());
    }

    void awaitBodyBarrier() throws Exception {
        if (!bodyBarrier.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("upload body barrier not reached");
        throwIfFailed();
    }

    void releaseBody() {
        releaseBody.countDown();
    }

    void awaitServerSuccess() throws Exception {
        if (!serverSuccess.await(15, TimeUnit.SECONDS)) {
            throw new IllegalStateException("proxy did not observe a successful SeaweedFS response", failure.get());
        }
    }

    IOException failure() {
        return failure.get();
    }

    private void handle() {
        try (Socket client = listener.accept(); Socket upstream = new Socket()) {
            client.setSoTimeout((int) Duration.ofSeconds(25).toMillis());
            upstream.connect(new InetSocketAddress("127.0.0.1", 8333), 3000);
            upstream.setSoTimeout((int) Duration.ofSeconds(25).toMillis());
            Thread responseForwarder = Thread.ofVirtual().start(() -> forwardResponse(upstream, client));
            forwardRequest(client, upstream);
            if (mode == Mode.INTERRUPT_AFTER_BODY) {
                client.close();
                upstream.close();
            }
            responseForwarder.join(Duration.ofSeconds(25).toMillis());
        } catch (IOException e) {
            failure.compareAndSet(null, e);
            bodyBarrier.countDown();
            serverSuccess.countDown();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            failure.compareAndSet(null, new IOException("fault gate interrupted", e));
            bodyBarrier.countDown();
            serverSuccess.countDown();
        } finally {
            handled.complete(null);
        }
    }

    private void forwardRequest(Socket client, Socket upstream) throws IOException, InterruptedException {
        InputStream input = client.getInputStream();
        OutputStream output = upstream.getOutputStream();
        byte[] header = readHeader(input);
        output.write(header);
        output.flush();
        long contentLength = contentLength(header);
        long forwarded = 0;
        byte[] buffer = new byte[16 * 1024];
        while (forwarded < contentLength) {
            int count = input.read(buffer, 0, (int) Math.min(buffer.length, contentLength - forwarded));
            if (count < 0) throw new IOException("client closed before the declared request body completed");
            output.write(buffer, 0, count);
            output.flush();
            forwarded += count;
            if (forwarded >= BODY_BARRIER_BYTES && bodyBarrier.getCount() != 0) {
                bodyBarrier.countDown();
                if (mode == Mode.INTERRUPT_AFTER_BODY) return;
                if (mode == Mode.HOLD_AFTER_BODY && !releaseBody.await(20, TimeUnit.SECONDS)) {
                    throw new IOException("test did not release the held upload body");
                }
            }
        }
    }

    private void forwardResponse(Socket upstream, Socket client) {
        try {
            InputStream input = upstream.getInputStream();
            OutputStream output = client.getOutputStream();
            while (true) {
                byte[] header = readHeader(input);
                String statusLine = new String(header, StandardCharsets.ISO_8859_1).split("\\r\\n", 2)[0];
                if (mode == Mode.DROP_AFTER_SUCCESS && statusLine.matches("HTTP/1\\.[01] 200(?: .*)?")) {
                    serverSuccess.countDown();
                    client.close();
                    return;
                }
                output.write(header);
                output.flush();
                if (statusLine.matches("HTTP/1\\.[01] 100(?: .*)?")) continue;
                long bodyLength = contentLength(header);
                long remaining = bodyLength;
                byte[] buffer = new byte[8192];
                while (remaining > 0) {
                    int count = input.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                    if (count < 0) return;
                    output.write(buffer, 0, count);
                    output.flush();
                    remaining -= count;
                }
                return;
            }
        } catch (IOException e) {
            if (mode != Mode.INTERRUPT_AFTER_BODY) failure.compareAndSet(null, e);
            upstreamClose(client);
            upstreamClose(upstream);
        }
    }

    private static byte[] readHeader(InputStream input) throws IOException {
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int match = 0;
        while (header.size() < 64 * 1024) {
            int next = input.read();
            if (next < 0) throw new IOException("connection ended before HTTP headers completed");
            header.write(next);
            if ((match == 0 || match == 2) && next == '\r') match++;
            else if ((match == 1 || match == 3) && next == '\n') {
                if (match == 3) return header.toByteArray();
                match++;
            } else match = next == '\r' ? 1 : 0;
        }
        throw new IOException("HTTP header exceeded the 64 KiB test limit");
    }

    private static long contentLength(byte[] header) throws IOException {
        String text = new String(header, StandardCharsets.ISO_8859_1);
        for (String line : text.split("\\r\\n")) {
            if (line.toLowerCase(Locale.ROOT).startsWith("content-length:")) {
                try { return Long.parseLong(line.substring(line.indexOf(':') + 1).trim()); }
                catch (NumberFormatException e) { throw new IOException("invalid Content-Length", e); }
            }
        }
        return 0;
    }

    private void throwIfFailed() throws IOException {
        if (failure.get() != null) throw failure.get();
    }

    private static void upstreamClose(Socket socket) {
        try { socket.close(); } catch (IOException ignored) {}
    }

    @Override
    public void close() {
        releaseBody.countDown();
        try { listener.close(); } catch (IOException ignored) {}
        if (!handled.isDone()) handled.cancel(true);
    }
}
