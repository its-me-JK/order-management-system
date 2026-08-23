#!/bin/sh

set -eu

readonly secret_path=/run/secrets/redis_password
readonly acl_path=/tmp/oms-users.acl
readonly canonical_password_path=/tmp/oms-redis-password.utf8
readonly max_password_size=8192

if [ ! -r "$secret_path" ]; then
  printf '%s\n' 'Redis password secret is unavailable.' >&2
  exit 1
fi

# Match the host resolver: remove exactly one terminal LF or CRLF written by
# secret-management tooling, while preserving every other credential byte.
secret_size="$(wc -c < "$secret_path" | tr -d '[:space:]')"

case "$secret_size" in
  '' | *[!0-9]*)
    printf '%s\n' 'Redis password secret could not be measured.' >&2
    exit 1
    ;;
esac

trim_size=0

if [ "$secret_size" -gt 0 ]; then
  final_byte="$(tail -c 1 "$secret_path" | od -An -tx1 | tr -d '[:space:]')"

  if [ "$final_byte" = '0a' ]; then
    trim_size=1

    if [ "$secret_size" -gt 1 ]; then
      penultimate_byte="$(tail -c 2 "$secret_path" | head -c 1 | od -An -tx1 | tr -d '[:space:]')"

      if [ "$penultimate_byte" = '0d' ]; then
        trim_size=2
      fi
    fi
  fi
fi

password_size=$((secret_size - trim_size))

if [ "$password_size" -le 0 ]; then
  printf '%s\n' 'Redis password secret must not be empty.' >&2
  exit 1
fi

if [ "$password_size" -gt "$max_password_size" ]; then
  printf '%s\n' 'Redis password secret exceeds the supported size.' >&2
  exit 1
fi

# Reject malformed or non-canonical UTF-8 before hashing so Redis ACL bytes
# exactly match the string passed by the Node.js client.
umask 077

if ! head -c "$password_size" "$secret_path" \
  | iconv -f UTF-8 -t UTF-8 > "$canonical_password_path" 2>/dev/null; then
  rm -f "$canonical_password_path"
  printf '%s\n' 'Redis password secret is not valid UTF-8.' >&2
  exit 1
fi

if ! head -c "$password_size" "$secret_path" | cmp -s - "$canonical_password_path"; then
  rm -f "$canonical_password_path"
  printf '%s\n' 'Redis password secret is not canonical UTF-8.' >&2
  exit 1
fi

password_sha256="$(sha256sum "$canonical_password_path")"
password_sha256="${password_sha256%% *}"
rm -f "$canonical_password_path"
unset final_byte password_size penultimate_byte secret_size trim_size

case "$password_sha256" in
  '' | *[!0-9a-f]*)
    printf '%s\n' 'Redis password secret could not be hashed.' >&2
    exit 1
    ;;
esac

if [ "${#password_sha256}" -ne 64 ]; then
  printf '%s\n' 'Redis password secret could not be hashed.' >&2
  exit 1
fi

{
  printf '%s\n' 'user default off'
  printf 'user oms_app on #%s ~oms:* +ping +eval +evalsha +time +get +set +pttl +del\n' \
    "$password_sha256"
} > "$acl_path"

unset password_sha256
chmod 0400 "$acl_path"
chown redis:redis "$acl_path"

exec /usr/bin/setpriv \
  --reuid redis \
  --regid redis \
  --clear-groups \
  redis-server /usr/local/etc/redis/redis.conf
