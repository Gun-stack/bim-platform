package com.bim.api;

import tools.jackson.databind.ObjectMapper;

/** jsonb 컬럼(text 로 읽음) → Map. pgjdbc 는 jsonb 를 PGobject 로 주므로 SQL 에서 ::text 캐스트 후 여기서 파싱. */
final class Json {
	private static final ObjectMapper M = new ObjectMapper();
	static Object parse(String s) { return s == null ? null : M.readValue(s, Object.class); }
}
