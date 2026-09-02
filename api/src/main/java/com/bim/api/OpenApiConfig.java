package com.bim.api;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** API 문서(springdoc): 엔드포인트 목록은 컨트롤러에서 자동, 여기는 제목·설명만.
 *  응답이 Map 이라 스키마는 비어 있다 — 응답 형태는 web/src/api.ts 의 타입이 계약. /swagger-ui.html, /v3/api-docs */
@Configuration
class OpenApiConfig {
	@Bean
	OpenAPI openApi() {
		return new OpenAPI().info(new Info().title("BIM Operations Platform API").version("0.1")
			.description("IFC 모델 변환·요소·설비 계통·운영 상태·자산/점검/작업지시·모니터링·내보내기(COBie/BCF). 응답 타입은 web/src/api.ts 참조."));
	}
}
