package com.krishnamurti.horizon;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class HorizonApplicationTests {

	@Test
	void contextLoads() {
	}

}
