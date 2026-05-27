package com.krishnamurti.horizon;

import org.springframework.boot.SpringApplication;

public class TestHorizonApplication {

	public static void main(String[] args) {
		SpringApplication.from(HorizonApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
