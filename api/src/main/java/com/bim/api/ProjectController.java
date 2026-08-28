package com.bim.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/projects")
class ProjectController {
	private final JdbcClient db;
	ProjectController(JdbcClient db) { this.db = db; }

	record Create(String name) {}

	@PostMapping
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Object> create(@RequestBody Create req) {
		if (req.name() == null || req.name().isBlank()) throw new BadRequest("name required");
		UUID id = db.sql("INSERT INTO project (name) VALUES (:name) RETURNING id")
			.param("name", req.name()).query(UUID.class).single();
		return Map.of("id", id, "name", req.name());
	}

	@GetMapping
	List<Map<String, Object>> list() {
		// location GeoJSON 은 M3
		return db.sql("SELECT id, name, created_at \"createdAt\" FROM project ORDER BY created_at DESC").query().listOfRows();
	}

	@ResponseStatus(HttpStatus.BAD_REQUEST)
	static class BadRequest extends RuntimeException { BadRequest(String m) { super(m); } }
	@ResponseStatus(HttpStatus.NOT_FOUND)
	static class NotFound extends RuntimeException { NotFound(String m) { super(m); } }
}
