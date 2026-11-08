package com.krishnamurti.horizon.note.web;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.lang.reflect.Type;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;

/** Bounds raw JSON request reads for Note creation and updates before Jackson deserializes them. */
@ControllerAdvice(assignableTypes = NoteController.class)
public final class NoteRequestBodyLimitAdvice extends RequestBodyAdviceAdapter {

    public static final long MAX_REQUEST_BYTES = 2_097_152;

    @Override
    public boolean supports(
            MethodParameter parameter,
            Type targetType,
            Class<? extends HttpMessageConverter<?>> converterType) {
        Method method = parameter.getMethod();
        return method != null && java.util.Set.of("create", "update").contains(method.getName());
    }

    @Override
    public HttpInputMessage beforeBodyRead(
            HttpInputMessage inputMessage,
            MethodParameter parameter,
            Type targetType,
            Class<? extends HttpMessageConverter<?>> converterType)
            throws IOException {
        long contentLength = inputMessage.getHeaders().getContentLength();
        if (contentLength > MAX_REQUEST_BYTES) throw new NoteRequestBodyTooLargeException();
        return new LimitedHttpInputMessage(inputMessage);
    }

    private static final class LimitedHttpInputMessage implements HttpInputMessage {
        private final HttpInputMessage delegate;

        private LimitedHttpInputMessage(HttpInputMessage delegate) {
            this.delegate = delegate;
        }

        @Override
        public InputStream getBody() throws IOException {
            return new LimitedInputStream(delegate.getBody());
        }

        @Override
        public HttpHeaders getHeaders() {
            return delegate.getHeaders();
        }
    }

    private static final class LimitedInputStream extends FilterInputStream {
        private long bytesRead;

        private LimitedInputStream(InputStream input) {
            super(input);
        }

        @Override
        public int read() throws IOException {
            int value = in.read();
            if (value == -1) return -1;
            if (++bytesRead > MAX_REQUEST_BYTES) throw new NoteRequestBodyTooLargeException();
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (length == 0) return 0;
            long remaining = MAX_REQUEST_BYTES - bytesRead;
            if (remaining == 0) {
                if (in.read() == -1) return -1;
                throw new NoteRequestBodyTooLargeException();
            }
            int allowed = (int) Math.min(length, remaining);
            int count = in.read(buffer, offset, allowed);
            if (count > 0) bytesRead += count;
            return count;
        }
    }

    public static final class NoteRequestBodyTooLargeException extends IOException {
        private NoteRequestBodyTooLargeException() {
            super("Note request body exceeds the maximum size");
        }
    }
}
