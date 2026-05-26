package com.krishnamurti.my_horizon;

import org.springframework.boot.SpringApplication;

public class TestMyHorizonApplication {

	public static void main(String[] args) {
		SpringApplication.from(MyHorizonApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
