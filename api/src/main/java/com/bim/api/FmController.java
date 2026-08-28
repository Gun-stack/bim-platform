package com.bim.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

/** HTTP adapter for facilities-management operations. */
@RestController
@RequestMapping("/api")
class FmController {
	private final FmService service;
	private final StatusService status;
	FmController(FmService service, StatusService status) { this.service = service; this.status = status; }

	@GetMapping("/models/{id}/assets") List<Map<String, Object>> assets(@PathVariable UUID id) { return service.assets(id); }
	@PostMapping("/models/{id}/assets") @ResponseStatus(HttpStatus.CREATED) Map<String, Object> createAsset(@PathVariable UUID id, @RequestBody FmService.AssetIn in) { return service.createAsset(id, in); }
	/** 일괄 등록 뒤 이미 이상 상태인 장비의 작업지시도 만든다(StatusService.sync) */
	@PostMapping("/models/{id}/assets/bulk") Map<String, Object> bulk(@PathVariable UUID id) { var r = new java.util.HashMap<>(service.bulk(id)); r.put("sync", status.sync(id)); return r; }
	@GetMapping("/assets/{id}") Map<String, Object> asset(@PathVariable UUID id) { return service.asset(id); }
	@PatchMapping("/assets/{id}") Map<String, Object> patchAsset(@PathVariable UUID id, @RequestBody FmService.AssetPatch p) { return service.patchAsset(id, p); }
	@DeleteMapping("/assets/{id}") @ResponseStatus(HttpStatus.NO_CONTENT) void deleteAsset(@PathVariable UUID id) { service.deleteAsset(id); }
	@PostMapping("/assets/{id}/inspections") @ResponseStatus(HttpStatus.CREATED) Map<String, Object> inspect(@PathVariable UUID id, @RequestBody FmService.InspectionIn in) { return service.inspect(id, in); }
	@GetMapping("/models/{id}/work-orders") List<Map<String, Object>> workOrders(@PathVariable UUID id, @RequestParam(required = false) String status) { return service.workOrders(id, status); }
	@PostMapping("/assets/{id}/work-orders") @ResponseStatus(HttpStatus.CREATED) Map<String, Object> createWorkOrder(@PathVariable UUID id, @RequestBody FmService.WorkOrderIn in) { return service.createWorkOrder(id, in); }
	@GetMapping("/work-orders/{id}") Map<String, Object> workOrder(@PathVariable UUID id) { return service.workOrder(id); }
	@PatchMapping("/work-orders/{id}") Map<String, Object> patchWorkOrder(@PathVariable UUID id, @RequestBody FmService.WorkOrderPatch p) { return service.patchWorkOrder(id, p); }
}
