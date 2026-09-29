#!/bin/sh
# 공개 데모: DEMO_PUBLIC=1 이면 파괴적 쓰기(업로드·프로젝트 생성·모델 삭제·재시도·썸네일/배치 PUT·자산 삭제)를 403 으로 막는다.
# 조회와 체험형 쓰기(경보 확인·상태 편집·작업지시 이동·정전 시나리오·점검)는 연다 — 데모의 핵심이 상호작용이라서.
# $demo_block 은 nginx.conf 의 location /api/ 가 늘 참조하므로 끄더라도 map 은 만든다(default 0). 화면 신호는 GET /api/config.
if [ "$DEMO_PUBLIC" = "1" ]; then
  cat > /etc/nginx/conf.d/demo-map.conf <<'MAP'
map "$request_method $uri" $demo_block {
  default 0;
  "~^POST /api/projects(/[^/]+/models)?$" 1;
  "~^DELETE /api/models/" 1;
  "~^POST /api/models/[^/]+/retry$" 1;
  "~^PUT /api/models/[^/]+/(thumbnail|footprint)$" 1;
  "~^DELETE /api/assets/" 1;
}
MAP
  printf 'location = /api/config { default_type application/json; add_header Cache-Control "no-cache" always; return 200 %s; }\n' "'{\"demo\":true}'" > /etc/nginx/conf.d/demo.inc
  echo "demo public ON — destructive writes blocked"
else
  printf 'map "$request_method $uri" $demo_block { default 0; }\n' > /etc/nginx/conf.d/demo-map.conf
  : > /etc/nginx/conf.d/demo.inc
  echo "demo public OFF"
fi
