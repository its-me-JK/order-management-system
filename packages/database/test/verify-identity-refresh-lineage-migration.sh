#!/usr/bin/env bash

set -euo pipefail

identity_test_database='oms_identity_refresh_lineage_integration'
identity_shadow_database='oms_identity_refresh_lineage_shadow'
identity_migration_name='20260823180000_create_identity_refresh_lineage'
identity_fixture='packages/database/test/fixtures/identity-refresh-lineage-valid.sql'
identity_mysql_endpoint=''
identity_mysql_port=''
repository_directory="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
  pwd
)"

cd "$repository_directory"
test -f pnpm-workspace.yaml
test -f "packages/database/prisma/migrations/$identity_migration_name/migration.sql"
test -f "$identity_fixture"

mkdir -p .local
exec {identity_migration_lock_fd}>.local/identity-refresh-lineage-migration.lock
if ! flock --exclusive --nonblock "$identity_migration_lock_fd"; then
  printf '%s\n' 'Another Identity refresh-lineage migration verification is running' >&2
  exit 2
fi

if [[ -n "${DATABASE_MIGRATION_URL:-}" ]]; then
  printf '%s\n' 'Refusing to verify Identity migrations while DATABASE_MIGRATION_URL is set' >&2
  exit 2
fi

if [[ -n "${DATABASE_SHADOW_URL:-}" ]]; then
  printf '%s\n' 'Refusing to verify Identity migrations while DATABASE_SHADOW_URL is set' >&2
  exit 2
fi

identity_mysql_endpoint="$(docker compose port mysql 3306)"
if [[ ! "$identity_mysql_endpoint" =~ ^127\.0\.0\.1:([1-9][0-9]{0,4})$ ]]; then
  printf '%s\n' 'Identity migration verification requires a loopback MySQL port' >&2
  exit 2
fi
identity_mysql_port=${BASH_REMATCH[1]}

run_root_admin_sql() {
  docker compose exec -T mysql sh -euc '
    MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
    export MYSQL_PWD

    exec mysql \
      --protocol=TCP \
      --host=127.0.0.1 \
      --user=root \
      --batch \
      --raw \
      --skip-column-names
  '
}

run_root_identity_sql() {
  local requested_database=$1

  if [[ "$requested_database" != "$identity_test_database" ]]; then
    printf '%s\n' 'Refusing to use an unexpected Identity migration test database' >&2
    return 2
  fi

  docker compose exec -T \
    -e IDENTITY_TEST_DATABASE="$requested_database" \
    mysql sh -euc '
      if [ "$IDENTITY_TEST_DATABASE" != "oms_identity_refresh_lineage_integration" ]; then
        printf "%s\n" "Unexpected Identity migration test database" >&2
        exit 2
      fi

      MYSQL_PWD="$(cat /run/secrets/mysql_root_password)"
      export MYSQL_PWD

      exec mysql \
        --protocol=TCP \
        --host=127.0.0.1 \
        --user=root \
        --database="$IDENTITY_TEST_DATABASE" \
        --batch \
        --raw \
        --skip-column-names
    '
}

reset_identity_test_database() {
  printf '%s\n' \
    'DROP DATABASE IF EXISTS `oms_identity_refresh_lineage_integration`;' \
    'DROP DATABASE IF EXISTS `oms_identity_refresh_lineage_shadow`;' \
    'CREATE DATABASE `oms_identity_refresh_lineage_integration` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' \
    'CREATE DATABASE `oms_identity_refresh_lineage_shadow` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;' \
    | run_root_admin_sql
}

drop_identity_test_database() {
  printf '%s\n' \
    'DROP DATABASE IF EXISTS `oms_identity_refresh_lineage_integration`;' \
    'DROP DATABASE IF EXISTS `oms_identity_refresh_lineage_shadow`;' \
    | run_root_admin_sql
}

resolve_shadow_database_url() {
  local root_password_file=${MYSQL_ROOT_PASSWORD_FILE:-.local/secrets/mysql-root-password}

  if [[ ! -f "$root_password_file" ]]; then
    printf '%s\n' 'Identity migration verification cannot read the root password file' >&2
    return 2
  fi

  IDENTITY_MYSQL_PORT="$identity_mysql_port" \
    IDENTITY_ROOT_PASSWORD_FILE="$root_password_file" \
    IDENTITY_SHADOW_DATABASE="$identity_shadow_database" \
    node -e '
      const { readFileSync } = require("node:fs");

      const password = readFileSync(process.env.IDENTITY_ROOT_PASSWORD_FILE, "utf8").trim();
      if (password === "") {
        throw new Error("The Identity migration root password file is empty");
      }

      const url = new URL("mysql://localhost");
      url.username = "root";
      url.password = password;
      url.hostname = "127.0.0.1";
      url.port = process.env.IDENTITY_MYSQL_PORT;
      url.pathname = `/${process.env.IDENTITY_SHADOW_DATABASE}`;
      process.stdout.write(url.toString());
    '
}

cleanup_identity_test_database() {
  local identity_test_status=$?
  trap - EXIT

  if ! drop_identity_test_database && [[ "$identity_test_status" -eq 0 ]]; then
    identity_test_status=1
  fi

  exit "$identity_test_status"
}

assert_sql_output() {
  local expected_output=$1
  local actual_output

  actual_output="$(run_root_identity_sql "$identity_test_database")"

  if [[ "$actual_output" != "$expected_output" ]]; then
    printf '%s\n' "Unexpected Identity migration assertion output" >&2
    printf 'expected: %s\n' "$expected_output" >&2
    printf 'actual:   %s\n' "$actual_output" >&2
    return 1
  fi
}

assert_sql_rejected() {
  local expected_constraint=$1
  local rejection_output

  if rejection_output="$(run_root_identity_sql "$identity_test_database" 2>&1)"; then
    printf '%s\n' "Identity migration accepted a row that should violate $expected_constraint" >&2
    return 1
  fi

  if [[ "$rejection_output" != *"$expected_constraint"* ]]; then
    printf '%s\n' "Identity migration rejected a row outside $expected_constraint" >&2
    printf '%s\n' "$rejection_output" >&2
    return 1
  fi
}

trap cleanup_identity_test_database EXIT
reset_identity_test_database

DATABASE_HOST='127.0.0.1' \
  DATABASE_MIGRATION_URL='' \
  DATABASE_NAME="$identity_test_database" \
  DATABASE_PORT="$identity_mysql_port" \
  pnpm db:migrate:deploy

# The second deployment must be a successful no-op against the same database.
DATABASE_HOST='127.0.0.1' \
  DATABASE_MIGRATION_URL='' \
  DATABASE_NAME="$identity_test_database" \
  DATABASE_PORT="$identity_mysql_port" \
  pnpm db:migrate:deploy

identity_shadow_database_url="$(resolve_shadow_database_url)"
DATABASE_HOST='127.0.0.1' \
  DATABASE_MIGRATION_URL='' \
  DATABASE_NAME="$identity_test_database" \
  DATABASE_PORT="$identity_mysql_port" \
  DATABASE_SHADOW_URL="$identity_shadow_database_url" \
  pnpm --filter @oms/database exec prisma migrate diff \
    --config prisma.config.ts \
    --from-migrations prisma/migrations \
    --to-schema prisma \
    --exit-code
unset identity_shadow_database_url

assert_sql_output '1|1|0' <<'SQL'
SELECT CONCAT(
    COUNT(*),
    _ascii'|',
    SUM(`finished_at` IS NOT NULL),
    _ascii'|',
    SUM(`rolled_back_at` IS NOT NULL)
)
FROM `_prisma_migrations`
WHERE `migration_name` = _ascii'20260823180000_create_identity_refresh_lineage';
SQL

assert_sql_output '4' <<'SQL'
SELECT COUNT(*)
FROM `information_schema`.`TABLES`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` IN (
      _ascii'identity_accounts',
      _ascii'identity_session_families',
      _ascii'identity_refresh_credentials',
      _ascii'identity_access_credentials'
  )
  AND `ENGINE` = _ascii'InnoDB';
SQL

assert_sql_output 'tinyint unsigned|YES|NULL|' <<'SQL'
SELECT CONCAT(
    `COLUMN_TYPE`,
    _ascii'|',
    `IS_NULLABLE`,
    _ascii'|',
    IF(`COLUMN_DEFAULT` IS NULL, _ascii'NULL', `COLUMN_DEFAULT`),
    _ascii'|',
    `EXTRA`
)
FROM `information_schema`.`COLUMNS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = _ascii'identity_refresh_credentials'
  AND `COLUMN_NAME` = _ascii'active_slot';
SQL

assert_sql_output '1|1|1' <<'SQL'
SELECT CONCAT(
    COUNT(*),
    _ascii'|',
    SUM(`tc`.`ENFORCED` = _ascii'YES'),
    _ascii'|',
    SUM(
        `cc`.`CHECK_CLAUSE` LIKE _utf8mb4'%<=>%'
        AND LOWER(`cc`.`CHECK_CLAUSE`) LIKE _utf8mb4'%if%consumed_at%'
    )
)
FROM `information_schema`.`TABLE_CONSTRAINTS` AS `tc`
INNER JOIN `information_schema`.`CHECK_CONSTRAINTS` AS `cc`
    ON `cc`.`CONSTRAINT_SCHEMA` = `tc`.`CONSTRAINT_SCHEMA`
   AND `cc`.`CONSTRAINT_NAME` = `tc`.`CONSTRAINT_NAME`
WHERE `tc`.`CONSTRAINT_SCHEMA` = DATABASE()
  AND `tc`.`TABLE_NAME` = _ascii'identity_refresh_credentials'
  AND `tc`.`CONSTRAINT_NAME` = _ascii'ck_identity_refresh_credentials_active_slot'
  AND `tc`.`CONSTRAINT_TYPE` = _ascii'CHECK';
SQL

assert_sql_output '4|4|1|1' <<'SQL'
SELECT CONCAT(
    COUNT(*),
    _ascii'|',
    SUM(`tc`.`ENFORCED` = _ascii'YES'),
    _ascii'|',
    SUM(
        `tc`.`CONSTRAINT_NAME` = _ascii'ck_identity_accounts_status'
        AND LOWER(`cc`.`CHECK_CLAUSE`) LIKE _utf8mb4'%cast%status%binary%'
    ),
    _ascii'|',
    SUM(
        `tc`.`CONSTRAINT_NAME` = _ascii'ck_identity_session_families_closed_reason'
        AND LOWER(`cc`.`CHECK_CLAUSE`) LIKE _utf8mb4'%cast%closed_reason%binary%'
    )
)
FROM `information_schema`.`TABLE_CONSTRAINTS` AS `tc`
INNER JOIN `information_schema`.`CHECK_CONSTRAINTS` AS `cc`
    ON `cc`.`CONSTRAINT_SCHEMA` = `tc`.`CONSTRAINT_SCHEMA`
   AND `cc`.`CONSTRAINT_NAME` = `tc`.`CONSTRAINT_NAME`
WHERE `tc`.`CONSTRAINT_SCHEMA` = DATABASE()
  AND `tc`.`CONSTRAINT_NAME` IN (
      _ascii'ck_identity_accounts_id_uuidv7',
      _ascii'ck_identity_accounts_status',
      _ascii'ck_identity_session_families_closed_reason',
      _ascii'ck_identity_access_credentials_lifetime'
  )
  AND `tc`.`CONSTRAINT_TYPE` = _ascii'CHECK';
SQL

assert_sql_output '1:family_id,2:active_slot' <<'SQL'
SELECT GROUP_CONCAT(
    CONCAT(`SEQ_IN_INDEX`, _ascii':', `COLUMN_NAME`)
    ORDER BY `SEQ_IN_INDEX`
    SEPARATOR ','
)
FROM `information_schema`.`STATISTICS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = _ascii'identity_refresh_credentials'
  AND `INDEX_NAME` = _ascii'uq_identity_refresh_credentials_family_active_slot'
  AND `NON_UNIQUE` = 0;
SQL

expected_foreign_keys='fk_identity_access_credentials_refresh_generation:identity_access_credentials:1:family_id:identity_refresh_credentials:family_id:RESTRICT:RESTRICT,fk_identity_access_credentials_refresh_generation:identity_access_credentials:2:sequence:identity_refresh_credentials:sequence:RESTRICT:RESTRICT,fk_identity_refresh_credentials_family:identity_refresh_credentials:1:family_id:identity_session_families:id:RESTRICT:RESTRICT,fk_identity_refresh_credentials_successor:identity_refresh_credentials:1:successor_id:identity_refresh_credentials:id:RESTRICT:RESTRICT,fk_identity_session_families_account:identity_session_families:1:account_id:identity_accounts:id:RESTRICT:RESTRICT'
assert_sql_output "$expected_foreign_keys" <<'SQL'
SET SESSION `group_concat_max_len` = 8192;
SELECT GROUP_CONCAT(
    CONCAT(
        `kcu`.`CONSTRAINT_NAME`,
        _ascii':',
        `kcu`.`TABLE_NAME`,
        _ascii':',
        `kcu`.`ORDINAL_POSITION`,
        _ascii':',
        `kcu`.`COLUMN_NAME`,
        _ascii':',
        `kcu`.`REFERENCED_TABLE_NAME`,
        _ascii':',
        `kcu`.`REFERENCED_COLUMN_NAME`,
        _ascii':',
        `rc`.`DELETE_RULE`,
        _ascii':',
        `rc`.`UPDATE_RULE`
    )
    ORDER BY `kcu`.`CONSTRAINT_NAME`, `kcu`.`ORDINAL_POSITION`
    SEPARATOR ','
)
FROM `information_schema`.`KEY_COLUMN_USAGE` AS `kcu`
INNER JOIN `information_schema`.`REFERENTIAL_CONSTRAINTS` AS `rc`
    ON `rc`.`CONSTRAINT_SCHEMA` = `kcu`.`CONSTRAINT_SCHEMA`
   AND `rc`.`CONSTRAINT_NAME` = `kcu`.`CONSTRAINT_NAME`
WHERE `kcu`.`CONSTRAINT_SCHEMA` = DATABASE()
  AND `kcu`.`CONSTRAINT_NAME` IN (
      _ascii'fk_identity_access_credentials_refresh_generation',
      _ascii'fk_identity_refresh_credentials_family',
      _ascii'fk_identity_refresh_credentials_successor',
      _ascii'fk_identity_session_families_account'
  )
  AND `kcu`.`REFERENCED_TABLE_NAME` IS NOT NULL;
SQL

run_root_identity_sql "$identity_test_database" < "$identity_fixture"

assert_sql_output '1|1|2|1|1|2' <<'SQL'
SELECT CONCAT(
    (SELECT COUNT(*) FROM `identity_accounts`),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `identity_session_families`
        WHERE `version` = 2
          AND `revoked_at` IS NULL
          AND `closed_reason` IS NULL
    ),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_refresh_credentials`),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `identity_refresh_credentials`
        WHERE `sequence` = 2
          AND `consumed_at` IS NULL
          AND `successor_id` IS NULL
          AND `active_slot` = 1
    ),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `identity_refresh_credentials`
        WHERE `sequence` = 1
          AND `consumed_at` IS NOT NULL
          AND `successor_id` = UNHEX('0198dcba000070008000000000000004')
          AND `active_slot` IS NULL
    ),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `identity_access_credentials` AS `access`
        INNER JOIN `identity_refresh_credentials` AS `refresh`
            ON `refresh`.`family_id` = `access`.`family_id`
           AND `refresh`.`sequence` = `access`.`sequence`
           AND `refresh`.`issued_at` = `access`.`issued_at`
    )
);
SQL

expected_microseconds='2026-08-23T12:00:00.123456Z|2026-08-23T12:30:00.654321Z|2026-08-23T13:30:00.654321Z|2026-08-30T12:00:00.123456Z|2026-08-23T12:30:00.654321Z|2026-08-23T13:30:00.654321Z|2026-08-23T12:45:00.654321Z'
assert_sql_output "$expected_microseconds" <<'SQL'
SELECT CONCAT(
    DATE_FORMAT(`family`.`created_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ'),
    _ascii'|',
    DATE_FORMAT(`family`.`last_rotated_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ'),
    _ascii'|',
    DATE_FORMAT(`family`.`idle_expires_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ'),
    _ascii'|',
    DATE_FORMAT(`family`.`absolute_expires_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ'),
    _ascii'|',
    DATE_FORMAT(`refresh`.`issued_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ'),
    _ascii'|',
    DATE_FORMAT(`refresh`.`expires_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ'),
    _ascii'|',
    DATE_FORMAT(`access`.`expires_at`, _ascii'%Y-%m-%dT%H:%i:%s.%fZ')
)
FROM `identity_session_families` AS `family`
INNER JOIN `identity_refresh_credentials` AS `refresh`
    ON `refresh`.`family_id` = `family`.`id`
   AND `refresh`.`sequence` = 2
INNER JOIN `identity_access_credentials` AS `access`
    ON `access`.`family_id` = `family`.`id`
   AND `access`.`sequence` = 2;
SQL

assert_sql_rejected 'ck_identity_accounts_id_uuidv7' <<'SQL'
INSERT INTO `identity_accounts` VALUES (
    UNHEX('00000000000000000000000000000001'),
    _ascii'invalid.uuid',
    _ascii'ACTIVE',
    1,
    '2026-08-23 16:00:00.111111',
    '2026-08-23 16:00:00.111111',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_accounts_login_name' <<'SQL'
INSERT INTO `identity_accounts` VALUES (
    UNHEX('0198dcba000070008000000000000033'),
    CONCAT(_ascii'invalid', CHAR(10)),
    _ascii'ACTIVE',
    1,
    '2026-08-23 16:00:00.131313',
    '2026-08-23 16:00:00.131313',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_accounts_login_name' <<'SQL'
INSERT INTO `identity_accounts` VALUES (
    UNHEX('0198dcba000070008000000000000034'),
    CONCAT(_ascii'invalid', CHAR(13)),
    _ascii'ACTIVE',
    1,
    '2026-08-23 16:00:00.141414',
    '2026-08-23 16:00:00.141414',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_accounts_lifecycle' <<'SQL'
INSERT INTO `identity_accounts` VALUES (
    UNHEX('0198dcba000070008000000000000031'),
    _ascii'invalid.status',
    _ascii'ACTIVE ',
    1,
    '2026-08-23 16:00:00.121212',
    '2026-08-23 16:00:00.121212',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_session_families_closed_reason' <<'SQL'
INSERT INTO `identity_session_families` VALUES (
    UNHEX('0198dcba000070008000000000000030'),
    UNHEX('0198dcba000070008000000000000001'),
    2,
    '2026-08-23 16:00:00.222222',
    '2026-08-23 16:00:00.222222',
    '2026-08-23 17:00:00.222222',
    '2026-08-30 16:00:00.222222',
    '2026-08-23 16:00:00.222222',
    _ascii'UNKNOWN'
);
SQL

assert_sql_rejected 'ck_identity_session_families_closed_reason' <<'SQL'
INSERT INTO `identity_session_families` VALUES (
    UNHEX('0198dcba000070008000000000000032'),
    UNHEX('0198dcba000070008000000000000001'),
    2,
    '2026-08-23 16:00:00.232323',
    '2026-08-23 16:00:00.232323',
    '2026-08-23 17:00:00.232323',
    '2026-08-30 16:00:00.232323',
    '2026-08-23 16:00:00.232323',
    _ascii'LOGOUT '
);
SQL

run_root_identity_sql "$identity_test_database" <<'SQL'
INSERT INTO `identity_session_families` VALUES (
    UNHEX('0198dcba000070008000000000000020'),
    UNHEX('0198dcba000070008000000000000001'),
    1,
    '2026-08-23 14:00:00.246810',
    '2026-08-23 14:00:00.246810',
    '2026-08-23 15:00:00.246810',
    '2026-08-30 14:00:00.246810',
    NULL,
    NULL
);

INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba000070008000000000000021'),
    UNHEX('0198dcba000070008000000000000020'),
    UNHEX(REPEAT('59', 32)),
    1,
    '2026-08-23 14:00:00.246810',
    '2026-08-23 15:00:00.246810',
    NULL,
    NULL,
    1
);
SQL

assert_sql_rejected 'ck_identity_access_credentials_lifetime' <<'SQL'
INSERT INTO `identity_access_credentials` VALUES (
    UNHEX('0198dcba000070008000000000000022'),
    UNHEX('0198dcba000070008000000000000020'),
    UNHEX(REPEAT('5a', 32)),
    1,
    '2026-08-23 14:00:00.246810',
    '2026-08-23 14:30:00.246811'
);
SQL

run_root_identity_sql "$identity_test_database" <<'SQL'
DELETE FROM `identity_refresh_credentials`
WHERE `id` = UNHEX('0198dcba000070008000000000000021');

DELETE FROM `identity_session_families`
WHERE `id` = UNHEX('0198dcba000070008000000000000020');
SQL

assert_sql_rejected 'ck_identity_session_families_timestamp_order' <<'SQL'
INSERT INTO `identity_session_families` VALUES (
    UNHEX('0198dcba000070008000000000000040'),
    UNHEX('0198dcba000070008000000000000001'),
    3,
    '2026-08-23 18:00:00.111111',
    '2026-08-23 18:30:00.111111',
    '2026-08-23 19:30:00.111111',
    '2026-08-30 18:00:00.111111',
    '2026-08-23 18:15:00.111111',
    _ascii'LOGOUT'
);
SQL

assert_sql_rejected 'ck_identity_session_families_absolute_lifetime' <<'SQL'
INSERT INTO `identity_session_families` VALUES (
    UNHEX('0198dcba000070008000000000000041'),
    UNHEX('0198dcba000070008000000000000001'),
    1,
    '2026-08-23 18:00:00.222222',
    '2026-08-23 18:00:00.222222',
    '2026-08-23 19:00:00.222222',
    '2026-08-24 18:00:00.222223',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_session_families_idle_lifetime' <<'SQL'
INSERT INTO `identity_session_families` VALUES (
    UNHEX('0198dcba000070008000000000000042'),
    UNHEX('0198dcba000070008000000000000001'),
    1,
    '2026-08-23 18:00:00.333333',
    '2026-08-23 18:00:00.333333',
    '2026-08-23 18:14:59.333333',
    '2026-08-30 18:00:00.333333',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_session_families_rotation_reachability' <<'SQL'
INSERT INTO `identity_session_families` VALUES (
    UNHEX('0198dcba000070008000000000000043'),
    UNHEX('0198dcba000070008000000000000001'),
    2,
    '2026-08-23 18:00:00.444444',
    '2026-08-24 18:00:00.444444',
    '2026-08-24 19:00:00.444444',
    '2026-08-30 18:00:00.444444',
    NULL,
    NULL
);
SQL

run_root_identity_sql "$identity_test_database" <<'SQL'
INSERT INTO `identity_session_families` VALUES
(
    UNHEX('0198dcba000070008000000000000050'),
    UNHEX('0198dcba000070008000000000000001'),
    1,
    '2026-08-23 20:00:00.111111',
    '2026-08-23 20:00:00.111111',
    '2026-08-23 21:00:00.111111',
    '2026-08-30 20:00:00.111111',
    NULL,
    NULL
),
(
    UNHEX('0198dcba000070008000000000000051'),
    UNHEX('0198dcba000070008000000000000001'),
    1,
    '2026-08-23 20:00:00.222222',
    '2026-08-23 20:00:00.222222',
    '2026-08-23 21:00:00.222222',
    '2026-08-30 20:00:00.222222',
    NULL,
    NULL
),
(
    UNHEX('0198dcba000070008000000000000052'),
    UNHEX('0198dcba000070008000000000000001'),
    1,
    '2026-08-23 20:00:00.333333',
    '2026-08-23 20:00:00.333333',
    '2026-08-23 21:00:00.333333',
    '2026-08-30 20:00:00.333333',
    NULL,
    NULL
),
(
    UNHEX('0198dcba000070008000000000000053'),
    UNHEX('0198dcba000070008000000000000001'),
    1,
    '2026-08-23 20:00:00.444444',
    '2026-08-23 20:00:00.444444',
    '2026-08-23 21:00:00.444444',
    '2026-08-30 20:00:00.444444',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_lifetime' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba000070008000000000000060'),
    UNHEX('0198dcba000070008000000000000050'),
    UNHEX(REPEAT('60', 32)),
    2,
    '2026-08-23 20:00:00.111111',
    '2026-08-23 20:00:01.111110',
    NULL,
    NULL,
    1
);
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_initial_lifetime' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba000070008000000000000061'),
    UNHEX('0198dcba000070008000000000000051'),
    UNHEX(REPEAT('61', 32)),
    1,
    '2026-08-23 20:00:00.222222',
    '2026-08-23 20:14:59.222222',
    NULL,
    NULL,
    1
);
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_consumption' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba000070008000000000000062'),
    UNHEX('0198dcba000070008000000000000052'),
    UNHEX(REPEAT('62', 32)),
    2,
    '2026-08-23 20:00:00.333333',
    '2026-08-23 21:00:00.333333',
    '2026-08-23 21:00:00.333333',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_successor' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba000070008000000000000063'),
    UNHEX('0198dcba000070008000000000000053'),
    UNHEX(REPEAT('63', 32)),
    2,
    '2026-08-23 20:00:00.444444',
    '2026-08-23 21:00:00.444444',
    '2026-08-23 20:30:00.444444',
    UNHEX('0198dcba000070008000000000000063'),
    NULL
);
SQL

run_root_identity_sql "$identity_test_database" <<'SQL'
DELETE FROM `identity_session_families`
WHERE `id` IN (
    UNHEX('0198dcba000070008000000000000050'),
    UNHEX('0198dcba000070008000000000000051'),
    UNHEX('0198dcba000070008000000000000052'),
    UNHEX('0198dcba000070008000000000000053')
);
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_active_slot' <<'SQL'
INSERT INTO `identity_refresh_credentials` (
    `id`, `family_id`, `digest`, `sequence`, `issued_at`, `expires_at`, `consumed_at`, `successor_id`
) VALUES (
    UNHEX('0198dcba000070008000000000000007'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('51', 32)),
    3,
    '2026-08-23 12:45:00.111111',
    '2026-08-23 13:45:00.111111',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_active_slot' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba000070008000000000000008'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('52', 32)),
    3,
    '2026-08-23 12:45:00.222222',
    '2026-08-23 13:45:00.222222',
    NULL,
    NULL,
    0
);
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_active_slot' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba000070008000000000000009'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('53', 32)),
    3,
    '2026-08-23 12:45:00.333333',
    '2026-08-23 13:45:00.333333',
    '2026-08-23 12:50:00.333333',
    NULL,
    1
);
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_active_slot' <<'SQL'
UPDATE `identity_refresh_credentials`
SET `active_slot` = NULL
WHERE `id` = UNHEX('0198dcba000070008000000000000004');
SQL

assert_sql_rejected 'ck_identity_refresh_credentials_active_slot' <<'SQL'
UPDATE `identity_refresh_credentials`
SET `active_slot` = 0
WHERE `id` = UNHEX('0198dcba000070008000000000000003');
SQL

assert_sql_rejected 'uq_identity_refresh_credentials_family_active_slot' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba00007000800000000000000a'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('54', 32)),
    3,
    '2026-08-23 12:45:00.444444',
    '2026-08-23 13:45:00.444444',
    NULL,
    NULL,
    1
);
SQL

assert_sql_rejected 'uq_identity_refresh_credentials_family_sequence' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba00007000800000000000000b'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('55', 32)),
    2,
    '2026-08-23 12:45:00.555555',
    '2026-08-23 13:45:00.555555',
    '2026-08-23 12:50:00.555555',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'uq_identity_refresh_credentials_digest' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba00007000800000000000000c'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('11', 32)),
    3,
    '2026-08-23 12:45:00.666666',
    '2026-08-23 13:45:00.666666',
    '2026-08-23 12:50:00.666666',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'uq_identity_refresh_credentials_successor' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba00007000800000000000000d'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('56', 32)),
    3,
    '2026-08-23 12:45:00.777777',
    '2026-08-23 13:45:00.777777',
    '2026-08-23 12:50:00.777777',
    UNHEX('0198dcba000070008000000000000004'),
    NULL
);
SQL

assert_sql_rejected 'fk_identity_refresh_credentials_family' <<'SQL'
INSERT INTO `identity_refresh_credentials` VALUES (
    UNHEX('0198dcba00007000800000000000000e'),
    UNHEX('0198dcba0000700080000000000000ff'),
    UNHEX(REPEAT('57', 32)),
    3,
    '2026-08-23 12:45:00.888888',
    '2026-08-23 13:45:00.888888',
    '2026-08-23 12:50:00.888888',
    NULL,
    NULL
);
SQL

assert_sql_rejected 'fk_identity_access_credentials_refresh_generation' <<'SQL'
INSERT INTO `identity_access_credentials` VALUES (
    UNHEX('0198dcba00007000800000000000000f'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('58', 32)),
    3,
    '2026-08-23 12:45:00.999999',
    '2026-08-23 13:00:00.999999'
);
SQL

assert_sql_rejected 'fk_identity_session_families_account' <<'SQL'
DELETE FROM `identity_accounts`
WHERE `id` = UNHEX('0198dcba000070008000000000000001');
SQL

assert_sql_output '1|2|2|1' <<'SQL'
SELECT CONCAT(
    (SELECT COUNT(*) FROM `identity_accounts`),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_refresh_credentials`),
    _ascii'|',
    (SELECT COUNT(*) FROM `identity_access_credentials`),
    _ascii'|',
    (
        SELECT COUNT(*)
        FROM `identity_refresh_credentials`
        WHERE `active_slot` = 1
    )
);
SQL

printf '%s\n' 'Identity refresh-lineage migration verified against real MySQL'
