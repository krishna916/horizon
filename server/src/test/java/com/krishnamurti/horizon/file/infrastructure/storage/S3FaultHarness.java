package com.krishnamurti.horizon.file.infrastructure.storage;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * A narrow TCP gate for deterministic faults while the real SeaweedFS S3 provider handles writes.
 */
public final class S3FaultHarness implements AutoCloseable {
    public enum Mode {
        HOLD_PUT,
        DROP_SUCCESSFUL_PUT_RESPONSE
    }

    private final ServerSocket listener;
    private final URI upstream;
    private final Mode mode;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final CountDownLatch putBuffered = new CountDownLatch(1);
    private final CountDownLatch releasePut = new CountDownLatch(1);
    private final CountDownLatch completed = new CountDownLatch(1);
    private final AtomicInteger requests = new AtomicInteger();
    private final AtomicInteger putRequests = new AtomicInteger();
    private final AtomicReference<Throwable> failure = new AtomicReference<>();

    public S3FaultHarness(URI upstream, Mode mode) throws IOException {
        this.upstream = upstream;
        this.mode = mode;
        listener = new ServerSocket();
        listener.bind(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0));
        executor.execute(this::serveOneRequest);
    }

    public URI endpoint() {
        return URI.create("http://127.0.0.1:" + listener.getLocalPort());
    }

    public int putRequests() {
        return putRequests.get();
    }

    public int requests() {
        return requests.get();
    }

    public void awaitBufferedPut(Duration timeout) throws Exception {
        if (!putBuffered.await(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            throw new AssertionError("S3 gate did not receive the complete PUT request");
        }
        rethrowFailure();
    }

    public void releasePut() {
        releasePut.countDown();
    }

    public void awaitCompletion(Duration timeout) throws Exception {
        if (!completed.await(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            throw new AssertionError("S3 gate did not complete the intercepted request");
        }
        rethrowFailure();
    }

    private void serveOneRequest() {
        try {
            while (!listener.isClosed()) {
                try (Socket client = listener.accept()) {
                    forwardOneRequest(client);
                }
            }
        } catch (IOException exception) {
            if (!listener.isClosed()) failure.compareAndSet(null, exception);
        } finally {
            putBuffered.countDown();
            completed.countDown();
        }
    }

    private void forwardOneRequest(Socket client) throws IOException {
        try {
            client.setSoTimeout(10_000);
            InputStream clientInput = client.getInputStream();
            byte[] requestHeader = readHeader(clientInput);
            String requestText = new String(requestHeader, StandardCharsets.ISO_8859_1);
            boolean isPut = requestText.startsWith("PUT ");
            requests.incrementAndGet();
            byte[] requestBody = readRequestBody(clientInput, requestText);
            if (isPut) {
                putRequests.incrementAndGet();
                putBuffered.countDown();
            }

            if (isPut && mode == Mode.HOLD_PUT) {
                if (!releasePut.await(10, TimeUnit.SECONDS)) {
                    throw new IOException("Timed out waiting to release the held PUT");
                }
            }

            try (Socket provider = new Socket()) {
                provider.connect(
                        new InetSocketAddress(upstream.getHost(), upstream.getPort()), 3_000);
                provider.setSoTimeout(8_000);
                OutputStream providerOutput = provider.getOutputStream();
                providerOutput.write(requestHeader);
                providerOutput.write(requestBody);
                providerOutput.flush();

                InputStream providerInput = provider.getInputStream();
                byte[] responseHeader = readFinalResponseHeader(providerInput);
                String responseText = new String(responseHeader, StandardCharsets.ISO_8859_1);
                boolean successfulPutResponse =
                        isPut && responseText.startsWith("HTTP/") && responseText.contains(" 200 ");
                completed.countDown();
                if (mode == Mode.DROP_SUCCESSFUL_PUT_RESPONSE && successfulPutResponse) return;

                OutputStream clientOutput = client.getOutputStream();
                clientOutput.write(responseHeader);
                clientOutput.write(readResponseBody(providerInput, responseText));
                clientOutput.flush();
            }
        } catch (Throwable exception) {
            failure.compareAndSet(null, exception);
        }
    }

    private static byte[] readHeader(InputStream input) throws IOException {
        ByteArrayOutputStream header = new ByteArrayOutputStream();
        int matched = 0;
        while (header.size() < 64 * 1024) {
            int value = input.read();
            if (value < 0) throw new IOException("S3 peer closed before the HTTP header ended");
            header.write(value);
            matched =
                    switch (matched) {
                        case 0 -> value == '\r' ? 1 : 0;
                        case 1 -> value == '\n' ? 2 : value == '\r' ? 1 : 0;
                        case 2 -> value == '\r' ? 3 : 0;
                        case 3 -> value == '\n' ? 4 : 0;
                        default -> 0;
                    };
            if (matched == 4) return header.toByteArray();
        }
        throw new IOException("S3 HTTP header exceeded the test gate bound");
    }

    private static byte[] readRequestBody(InputStream input, String header) throws IOException {
        int contentLength = contentLength(header);
        byte[] body = input.readNBytes(contentLength);
        if (body.length != contentLength) throw new IOException("Incomplete S3 request body");
        return body;
    }

    private static byte[] readFinalResponseHeader(InputStream input) throws IOException {
        byte[] header = readHeader(input);
        while (new String(header, StandardCharsets.ISO_8859_1).startsWith("HTTP/1.1 100 ")) {
            header = readHeader(input);
        }
        return header;
    }

    private static byte[] readResponseBody(InputStream input, String header) throws IOException {
        int length = contentLength(header);
        if (length == 0) return new byte[0];
        byte[] body = input.readNBytes(length);
        if (body.length != length) throw new IOException("Incomplete S3 response body");
        return body;
    }

    private static int contentLength(String header) throws IOException {
        for (String line : header.split("\\r?\\n", -1)) {
            if (line.toLowerCase(Locale.ROOT).startsWith("content-length:")) {
                try {
                    return Integer.parseInt(line.substring(line.indexOf(':') + 1).trim());
                } catch (NumberFormatException exception) {
                    throw new IOException("Invalid S3 Content-Length", exception);
                }
            }
        }
        return 0;
    }

    private void rethrowFailure() throws Exception {
        Throwable exception = failure.get();
        if (exception == null) return;
        if (exception instanceof Exception checked) throw checked;
        throw new AssertionError("S3 fault gate failed", exception);
    }

    @Override
    public void close() throws IOException {
        releasePut.countDown();
        listener.close();
        executor.shutdownNow();
    }
}
