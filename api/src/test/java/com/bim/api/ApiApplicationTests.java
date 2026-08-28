package com.bim.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import static org.assertj.core.api.Assertions.assertThat;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ApiApplicationTests {
	@Autowired FmController fmController;
	@Autowired FmService fmService;
	@Autowired StatusController statusController;
	@Autowired StatusService statusService;

	@Test
	void contextLoads() {
		assertThat(fmController).isNotNull();
		assertThat(fmService).isNotNull();
		assertThat(statusController).isNotNull();
		assertThat(statusService).isNotNull();
	}

}
