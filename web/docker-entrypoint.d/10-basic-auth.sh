#!/bin/sh
# 최소 인증: BASIC_AUTH_USER / BASIC_AUTH_PASSWORD 가 둘 다 있으면 nginx Basic 인증을 켠다 (화면·API·glb 전부, 이 컨테이너가 유일한 노출 지점).
# 비어 있으면 열어 둔다(로컬 데모). 단일 사용자·단일 비밀번호 — 외부 데모 배포의 최소선이고, 계정별 권한은 다음 단계.
# nginx 는 {PLAIN} 형식을 받아 openssl/htpasswd 가 필요 없다. 파일은 컨테이너 안에만 있다.
if [ -n "$BASIC_AUTH_USER" ] && [ -n "$BASIC_AUTH_PASSWORD" ]; then
  printf '%s:{PLAIN}%s\n' "$BASIC_AUTH_USER" "$BASIC_AUTH_PASSWORD" > /etc/nginx/.htpasswd
  printf 'auth_basic "bim-platform"; auth_basic_user_file /etc/nginx/.htpasswd;\n' > /etc/nginx/conf.d/auth.inc
  echo "basic auth ON (user $BASIC_AUTH_USER)"
else
  : > /etc/nginx/conf.d/auth.inc
  echo "basic auth OFF"
fi
