package com.bim.api;

import java.util.Map;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** API 오류 한 곳: 던지는 예외 3종(400/404/409)과 DB 제약(CHECK/UNIQUE/FK) 위반 → 400 변환.
 *  상태 enum 검증을 DB 에 두는 대신 여기서 메시지만 다듬는다. */
@RestControllerAdvice
class ApiErrors {
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	static class BadRequest extends RuntimeException { BadRequest(String m) { super(m); } }
	@ResponseStatus(HttpStatus.NOT_FOUND)
	static class NotFound extends RuntimeException { NotFound(String m) { super(m); } }
	@ResponseStatus(HttpStatus.CONFLICT)
	static class Conflict extends RuntimeException { Conflict(String m) { super(m); } }

	@ExceptionHandler(DataIntegrityViolationException.class)
	@ResponseStatus(HttpStatus.BAD_REQUEST)
	Map<String, Object> constraint(DataIntegrityViolationException e) {
		String m = e.getMostSpecificCause().getMessage();
		return Map.of("status", 400, "error", "Bad Request", "message", m == null ? "constraint violation" : m.lines().findFirst().orElse(m));
	}
}
