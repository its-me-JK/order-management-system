-- One complete two-generation session lineage. Distinct fractional digits are
-- deliberate: the verifier must prove that every DATETIME(6) survives exactly.
INSERT INTO `identity_accounts` (
    `id`,
    `login_name`,
    `status`,
    `version`,
    `created_at`,
    `updated_at`,
    `suspended_at`,
    `deactivated_at`
) VALUES (
    UNHEX('0198dcba000070008000000000000001'),
    _ascii'admin.primary',
    _ascii'ACTIVE',
    1,
    '2026-08-23 12:00:00.123456',
    '2026-08-23 12:00:00.123456',
    NULL,
    NULL
);

INSERT INTO `identity_session_families` (
    `id`,
    `account_id`,
    `version`,
    `created_at`,
    `last_rotated_at`,
    `idle_expires_at`,
    `absolute_expires_at`,
    `revoked_at`,
    `closed_reason`
) VALUES (
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX('0198dcba000070008000000000000001'),
    1,
    '2026-08-23 12:00:00.123456',
    '2026-08-23 12:00:00.123456',
    '2026-08-23 13:00:00.123456',
    '2026-08-30 12:00:00.123456',
    NULL,
    NULL
);

INSERT INTO `identity_refresh_credentials` (
    `id`,
    `family_id`,
    `digest`,
    `sequence`,
    `issued_at`,
    `expires_at`,
    `consumed_at`,
    `successor_id`,
    `active_slot`
) VALUES (
    UNHEX('0198dcba000070008000000000000003'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('11', 32)),
    1,
    '2026-08-23 12:00:00.123456',
    '2026-08-23 13:00:00.123456',
    NULL,
    NULL,
    1
);

INSERT INTO `identity_access_credentials` (
    `id`,
    `family_id`,
    `digest`,
    `sequence`,
    `issued_at`,
    `expires_at`
) VALUES (
    UNHEX('0198dcba000070008000000000000005'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('33', 32)),
    1,
    '2026-08-23 12:00:00.123456',
    '2026-08-23 12:15:00.123456'
);

START TRANSACTION;

UPDATE `identity_refresh_credentials`
SET
    `consumed_at` = '2026-08-23 12:30:00.654321',
    `active_slot` = NULL
WHERE `id` = UNHEX('0198dcba000070008000000000000003')
  AND `family_id` = UNHEX('0198dcba000070008000000000000002')
  AND `sequence` = 1
  AND `consumed_at` IS NULL
  AND `active_slot` = 1;

INSERT INTO `identity_refresh_credentials` (
    `id`,
    `family_id`,
    `digest`,
    `sequence`,
    `issued_at`,
    `expires_at`,
    `consumed_at`,
    `successor_id`,
    `active_slot`
) VALUES (
    UNHEX('0198dcba000070008000000000000004'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('22', 32)),
    2,
    '2026-08-23 12:30:00.654321',
    '2026-08-23 13:30:00.654321',
    NULL,
    NULL,
    1
);

INSERT INTO `identity_access_credentials` (
    `id`,
    `family_id`,
    `digest`,
    `sequence`,
    `issued_at`,
    `expires_at`
) VALUES (
    UNHEX('0198dcba000070008000000000000006'),
    UNHEX('0198dcba000070008000000000000002'),
    UNHEX(REPEAT('44', 32)),
    2,
    '2026-08-23 12:30:00.654321',
    '2026-08-23 12:45:00.654321'
);

UPDATE `identity_refresh_credentials`
SET `successor_id` = UNHEX('0198dcba000070008000000000000004')
WHERE `id` = UNHEX('0198dcba000070008000000000000003')
  AND `successor_id` IS NULL;

UPDATE `identity_session_families`
SET
    `version` = 2,
    `last_rotated_at` = '2026-08-23 12:30:00.654321',
    `idle_expires_at` = '2026-08-23 13:30:00.654321'
WHERE `id` = UNHEX('0198dcba000070008000000000000002')
  AND `version` = 1;

COMMIT;
