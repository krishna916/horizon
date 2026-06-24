package com.krishnamurti.horizon;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.beans.factory.annotation.Autowired;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class HorizonApplicationTests {

	@Autowired
	private org.springframework.context.ApplicationContext context;

	@Test
	void contextLoads() {
		System.out.println("=== BEANS IN CONTEXT ===");
		for (String name : context.getBeanDefinitionNames()) {
			try {
				System.out.println(name + " -> " + context.getBean(name).getClass().getName());
			} catch (Exception e) {
				System.out.println(name + " -> (failed to get bean: " + e.getMessage() + ")");
			}
		}
		System.out.println("========================");
	}

}
