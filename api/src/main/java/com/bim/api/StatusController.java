package com.bim.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.web.bind.annotation.*;

/** HTTP adapter for runtime status and power simulation operations. */
@RestController
@RequestMapping("/api/models/{id}")
class StatusController {
	private final StatusService service;
	StatusController(StatusService service) { this.service = service; }

	@PatchMapping("/elements/{globalId}/status")
	Map<String, Object> patch(@PathVariable UUID id, @PathVariable String globalId, @RequestBody Map<String, Object> patch) {
		return service.patch(id, globalId, patch);
	}

	@GetMapping("/status") List<Map<String, Object>> list(@PathVariable UUID id) { return service.list(id); }
	@GetMapping("/elements/{globalId}/readings") List<Map<String, Object>> readings(@PathVariable UUID id, @PathVariable String globalId, @RequestParam(defaultValue = "500") int limit) { return service.readings(id, globalId, limit); }
	@PostMapping("/status/sync") Map<String, Object> sync(@PathVariable UUID id) { return service.sync(id); }
	@PostMapping("/power") Map<String, Object> power(@PathVariable UUID id, @RequestParam String source) { return service.power(id, source); }
	@GetMapping("/power") Map<String, Object> powerNow(@PathVariable UUID id) { return service.powerNow(id); }
}
