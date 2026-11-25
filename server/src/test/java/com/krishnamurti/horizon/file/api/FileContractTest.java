package com.krishnamurti.horizon.file.api;

import static org.assertj.core.api.Assertions.assertThat;

import com.krishnamurti.horizon.file.api.model.FileContent;
import com.krishnamurti.horizon.file.api.model.FileMetadata;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class FileContractTest {
    @Test
    void closeReleasesReadStream() throws IOException {
        AtomicInteger closes = new AtomicInteger();
        InputStream stream =
                new ByteArrayInputStream(new byte[0]) {
                    @Override
                    public void close() {
                        closes.incrementAndGet();
                    }
                };
        FileContent content =
                new FileContent(new FileMetadata("a.txt", "text/plain", null, 0, ""), stream);
        content.close();
        assertThat(closes).hasValue(1);
    }

    @Test
    void apiDoesNotExposeProviderTypes() {
        Method[] methods = FileService.class.getMethods();
        assertThat(methods).isNotEmpty();
        assertThat(
                        Arrays.stream(methods)
                                .flatMap(method -> Arrays.stream(method.getParameterTypes()))
                                .map(Class::getName))
                .noneMatch(name -> name.startsWith("software.amazon.awssdk"));
        assertThat(Arrays.stream(methods).map(Method::getReturnType).map(Class::getName))
                .noneMatch(name -> name.startsWith("software.amazon.awssdk"));
    }
}
