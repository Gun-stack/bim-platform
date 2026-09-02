package com.bim.api;

import tools.jackson.databind.ObjectMapper;

/** jsonb ↔ Map. pgjdbc 는 jsonb 를 PGobject 로 주므로 SQL 에서 ::text 캐스트 후 parse(), 쓸 때는 write() 결과를 ::jsonb 로. */
final class Json {
	private static final ObjectMapper M = new ObjectMapper();
	static Object parse(String s) { return s == null ? null : M.readValue(s, Object.class); }
	static String write(Object o) { return M.writeValueAsString(o); }
}
