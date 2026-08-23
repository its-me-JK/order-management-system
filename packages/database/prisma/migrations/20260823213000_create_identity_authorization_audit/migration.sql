-- Identity authorization and security evidence are intentionally landed before
-- their persistence adapters. The built-in rows are immutable baseline policy,
-- not runtime authorization events. No route consumes these tables yet.

-- CreateTable
CREATE TABLE `identity_permissions` (
    `code` VARCHAR(98) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `description` VARCHAR(160) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,

    CONSTRAINT `ck_identity_permissions_code`
        CHECK (
            REGEXP_LIKE(
                `code`,
                _ascii'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*\\z',
                _ascii'c'
            )
            AND CHAR_LENGTH(SUBSTRING_INDEX(`code`, _ascii'.', 1)) <= 32
            AND CHAR_LENGTH(
                SUBSTRING_INDEX(
                    SUBSTRING_INDEX(`code`, _ascii'.', 2),
                    _ascii'.',
                    -1
                )
            ) <= 32
            AND CHAR_LENGTH(SUBSTRING_INDEX(`code`, _ascii'.', -1)) <= 32
        ),
    CONSTRAINT `ck_identity_permissions_description`
        CHECK (
            CHAR_LENGTH(`description`) BETWEEN 1 AND 160
            AND NOT REGEXP_LIKE(`description`, _utf8mb4'[\\p{C}]', _ascii'c')
            AND NOT REGEXP_LIKE(
                REPLACE(`description`, _utf8mb4' ', _utf8mb4''),
                _utf8mb4'[\\p{White_Space}]',
                _ascii'c'
            )
            AND ORD(LEFT(`description`, 1)) <> 32
            AND ORD(RIGHT(`description`, 1)) <> 32
            AND LOCATE(_utf8mb4'  ', `description`) = 0
        ),

    PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `identity_roles` (
    `id` BINARY(16) NOT NULL,
    `code` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `display_name` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_cs NOT NULL,
    `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `retired_at` DATETIME(6) NULL,

    CONSTRAINT `ck_identity_roles_id_uuidv7`
        CHECK (
            (ORD(SUBSTRING(`id`, 7, 1)) & 240) = 112
            AND (ORD(SUBSTRING(`id`, 9, 1)) & 192) = 128
        ),
    CONSTRAINT `ck_identity_roles_code`
        CHECK (
            CHAR_LENGTH(`code`) BETWEEN 3 AND 64
            AND REGEXP_LIKE(
                `code`,
                _ascii'^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*\\z',
                _ascii'c'
            )
        ),
    CONSTRAINT `ck_identity_roles_display_name`
        CHECK (
            CHAR_LENGTH(`display_name`) BETWEEN 1 AND 100
            AND NOT REGEXP_LIKE(`display_name`, _utf8mb4'[\\p{C}]', _ascii'c')
            AND NOT REGEXP_LIKE(
                REPLACE(`display_name`, _utf8mb4' ', _utf8mb4''),
                _utf8mb4'[\\p{White_Space}]',
                _ascii'c'
            )
            AND ORD(LEFT(`display_name`, 1)) <> 32
            AND ORD(RIGHT(`display_name`, 1)) <> 32
            AND LOCATE(_utf8mb4'  ', `display_name`) = 0
        ),
    CONSTRAINT `ck_identity_roles_status`
        CHECK (
            BINARY `status` IN (
                _binary'ACTIVE',
                _binary'RETIRED'
            )
        ),
    CONSTRAINT `ck_identity_roles_version`
        CHECK (`version` >= 1),
    CONSTRAINT `ck_identity_roles_timestamp_order`
        CHECK (
            `updated_at` >= `created_at`
            AND (
                `retired_at` IS NULL
                OR (
                    `retired_at` >= `created_at`
                    AND `retired_at` <= `updated_at`
                )
            )
        ),
    CONSTRAINT `ck_identity_roles_lifecycle`
        CHECK (
            (
                BINARY `status` = _binary'ACTIVE'
                AND `retired_at` IS NULL
                AND (`version` <> 1 OR `updated_at` = `created_at`)
            )
            OR (
                BINARY `status` = _binary'RETIRED'
                AND `version` >= 2
                AND `retired_at` IS NOT NULL
                AND `retired_at` = `updated_at`
            )
        ),

    UNIQUE INDEX `uq_identity_roles_code` (`code`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `identity_role_permissions` (
    `role_id` BINARY(16) NOT NULL,
    `permission_code` VARCHAR(98) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,

    INDEX `ix_identity_role_permissions_permission_role` (`permission_code`, `role_id`),
    PRIMARY KEY (`role_id`, `permission_code`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `identity_account_roles` (
    `account_id` BINARY(16) NOT NULL,
    `role_id` BINARY(16) NOT NULL,

    INDEX `ix_identity_account_roles_role_account` (`role_id`, `account_id`),
    PRIMARY KEY (`account_id`, `role_id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `identity_security_events` (
    `id` BINARY(16) NOT NULL,
    `event_type` VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `outcome` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `reason_code` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `actor_account_id` BINARY(16) NULL,
    `subject_account_id` BINARY(16) NULL,
    `role_id` BINARY(16) NULL,
    `session_id` BINARY(16) NULL,
    `permission_code` VARCHAR(98) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `request_id` BINARY(16) NULL,
    `correlation_id` BINARY(16) NULL,
    `operator_reference` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `occurred_at` DATETIME(6) NOT NULL,

    CONSTRAINT `ck_identity_security_events_id_uuidv7`
        CHECK (
            (ORD(SUBSTRING(`id`, 7, 1)) & 240) = 112
            AND (ORD(SUBSTRING(`id`, 9, 1)) & 192) = 128
        ),
    CONSTRAINT `ck_identity_security_events_event_type`
        CHECK (
            BINARY `event_type` IN (
                _binary'ADMINISTRATOR_BOOTSTRAP',
                _binary'ACCOUNT_CREATION',
                _binary'LOGIN',
                _binary'SESSION_REFRESH',
                _binary'LOGOUT',
                _binary'SESSION_FAMILY_REVOCATION',
                _binary'PASSWORD_AUTHENTICATOR_DISABLE',
                _binary'PASSWORD_AUTHENTICATOR_REBIND',
                _binary'PASSWORD_REPLACEMENT',
                _binary'ACCOUNT_SUSPENSION',
                _binary'ACCOUNT_RESUMPTION',
                _binary'ACCOUNT_DEACTIVATION',
                _binary'ROLE_CREATION',
                _binary'ROLE_RENAME',
                _binary'ROLE_RETIREMENT',
                _binary'ROLE_PERMISSION_GRANT',
                _binary'ROLE_PERMISSION_REVOKE',
                _binary'ACCOUNT_ROLE_GRANT',
                _binary'ACCOUNT_ROLE_REVOKE'
            )
        ),
    CONSTRAINT `ck_identity_security_events_outcome`
        CHECK (
            BINARY `outcome` IN (
                _binary'SUCCEEDED',
                _binary'REJECTED'
            )
        ),
    CONSTRAINT `ck_identity_security_events_reason_code`
        CHECK (
            `reason_code` IS NULL
            OR BINARY `reason_code` IN (
                _binary'INVALID_CREDENTIALS',
                _binary'AUTHENTICATOR_COOLDOWN',
                _binary'AUTHENTICATOR_REBIND_REQUIRED',
                _binary'ACCOUNT_INACTIVE',
                _binary'REFRESH_REUSE_DETECTED',
                _binary'SESSION_LIMIT_REACHED',
                _binary'ACCOUNT_SUSPENDED',
                _binary'ACCOUNT_DEACTIVATED',
                _binary'PASSWORD_REPLACED',
                _binary'PASSWORD_REBOUND'
            )
        ),
    CONSTRAINT `ck_identity_security_events_event_result`
        CHECK (
            (
                BINARY `event_type` = _binary'LOGIN'
                AND (
                    (
                        BINARY `outcome` = _binary'SUCCEEDED'
                        AND `reason_code` IS NULL
                    )
                    OR (
                        BINARY `outcome` = _binary'REJECTED'
                        AND `reason_code` IS NOT NULL
                        AND BINARY `reason_code` IN (
                            _binary'INVALID_CREDENTIALS',
                            _binary'AUTHENTICATOR_COOLDOWN',
                            _binary'AUTHENTICATOR_REBIND_REQUIRED',
                            _binary'ACCOUNT_INACTIVE'
                        )
                    )
                )
            )
            OR (
                BINARY `event_type` = _binary'SESSION_REFRESH'
                AND (
                    (
                        BINARY `outcome` = _binary'SUCCEEDED'
                        AND `reason_code` IS NULL
                    )
                    OR (
                        BINARY `outcome` = _binary'REJECTED'
                        AND `reason_code` IS NOT NULL
                        AND BINARY `reason_code` = _binary'REFRESH_REUSE_DETECTED'
                    )
                )
            )
            OR (
                BINARY `event_type` = _binary'SESSION_FAMILY_REVOCATION'
                AND BINARY `outcome` = _binary'SUCCEEDED'
                AND `reason_code` IS NOT NULL
                AND BINARY `reason_code` IN (
                    _binary'SESSION_LIMIT_REACHED',
                    _binary'ACCOUNT_SUSPENDED',
                    _binary'ACCOUNT_DEACTIVATED',
                    _binary'PASSWORD_REPLACED',
                    _binary'PASSWORD_REBOUND'
                )
            )
            OR (
                BINARY `event_type` IN (
                    _binary'ADMINISTRATOR_BOOTSTRAP',
                    _binary'ACCOUNT_CREATION',
                    _binary'LOGOUT',
                    _binary'PASSWORD_AUTHENTICATOR_DISABLE',
                    _binary'PASSWORD_AUTHENTICATOR_REBIND',
                    _binary'PASSWORD_REPLACEMENT',
                    _binary'ACCOUNT_SUSPENSION',
                    _binary'ACCOUNT_RESUMPTION',
                    _binary'ACCOUNT_DEACTIVATION',
                    _binary'ROLE_CREATION',
                    _binary'ROLE_RENAME',
                    _binary'ROLE_RETIREMENT',
                    _binary'ROLE_PERMISSION_GRANT',
                    _binary'ROLE_PERMISSION_REVOKE',
                    _binary'ACCOUNT_ROLE_GRANT',
                    _binary'ACCOUNT_ROLE_REVOKE'
                )
                AND BINARY `outcome` = _binary'SUCCEEDED'
                AND `reason_code` IS NULL
            )
        ),
    CONSTRAINT `ck_identity_security_events_actor_uuidv7`
        CHECK (
            `actor_account_id` IS NULL
            OR (
                (ORD(SUBSTRING(`actor_account_id`, 7, 1)) & 240) = 112
                AND (ORD(SUBSTRING(`actor_account_id`, 9, 1)) & 192) = 128
            )
        ),
    CONSTRAINT `ck_identity_security_events_subject_uuidv7`
        CHECK (
            `subject_account_id` IS NULL
            OR (
                (ORD(SUBSTRING(`subject_account_id`, 7, 1)) & 240) = 112
                AND (ORD(SUBSTRING(`subject_account_id`, 9, 1)) & 192) = 128
            )
        ),
    CONSTRAINT `ck_identity_security_events_role_uuidv7`
        CHECK (
            `role_id` IS NULL
            OR (
                (ORD(SUBSTRING(`role_id`, 7, 1)) & 240) = 112
                AND (ORD(SUBSTRING(`role_id`, 9, 1)) & 192) = 128
            )
        ),
    CONSTRAINT `ck_identity_security_events_session_uuidv7`
        CHECK (
            `session_id` IS NULL
            OR (
                (ORD(SUBSTRING(`session_id`, 7, 1)) & 240) = 112
                AND (ORD(SUBSTRING(`session_id`, 9, 1)) & 192) = 128
            )
        ),
    CONSTRAINT `ck_identity_security_events_request_uuidv4`
        CHECK (
            `request_id` IS NULL
            OR (
                (ORD(SUBSTRING(`request_id`, 7, 1)) & 240) = 64
                AND (ORD(SUBSTRING(`request_id`, 9, 1)) & 192) = 128
            )
        ),
    CONSTRAINT `ck_identity_security_events_correlation_uuid`
        CHECK (
            `correlation_id` IS NULL
            OR (
                (ORD(SUBSTRING(`correlation_id`, 7, 1)) & 240) IN (64, 112)
                AND (ORD(SUBSTRING(`correlation_id`, 9, 1)) & 192) = 128
            )
        ),
    CONSTRAINT `ck_identity_security_events_permission_code`
        CHECK (
            `permission_code` IS NULL
            OR (
                REGEXP_LIKE(
                    `permission_code`,
                    _ascii'^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*\\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*\\z',
                    _ascii'c'
                )
                AND CHAR_LENGTH(
                    SUBSTRING_INDEX(`permission_code`, _ascii'.', 1)
                ) <= 32
                AND CHAR_LENGTH(
                    SUBSTRING_INDEX(
                        SUBSTRING_INDEX(`permission_code`, _ascii'.', 2),
                        _ascii'.',
                        -1
                    )
                ) <= 32
                AND CHAR_LENGTH(
                    SUBSTRING_INDEX(`permission_code`, _ascii'.', -1)
                ) <= 32
            )
        ),
    CONSTRAINT `ck_identity_security_events_operator_reference`
        CHECK (
            `operator_reference` IS NULL
            OR REGEXP_LIKE(
                `operator_reference`,
                _ascii'^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\\z',
                _ascii'c'
            )
        ),
    CONSTRAINT `ck_identity_security_events_transport_context`
        CHECK (
            (`request_id` IS NULL OR `correlation_id` IS NOT NULL)
            AND (
                `operator_reference` IS NULL
                OR (`request_id` IS NULL AND `correlation_id` IS NULL)
            )
        ),
    CONSTRAINT `ck_identity_security_events_event_context`
        CHECK (
            (
                BINARY `event_type` = _binary'ADMINISTRATOR_BOOTSTRAP'
                AND `actor_account_id` IS NULL
                AND `subject_account_id` IS NOT NULL
                AND `role_id` IS NOT NULL
                AND `session_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NOT NULL
            )
            OR (
                BINARY `event_type` = _binary'LOGIN'
                AND `role_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
                AND (
                    (
                        BINARY `outcome` = _binary'SUCCEEDED'
                        AND `actor_account_id` IS NOT NULL
                        AND `subject_account_id` IS NOT NULL
                        AND `actor_account_id` = `subject_account_id`
                        AND `session_id` IS NOT NULL
                    )
                    OR (
                        BINARY `outcome` = _binary'REJECTED'
                        AND `actor_account_id` IS NULL
                        AND `session_id` IS NULL
                    )
                )
            )
            OR (
                BINARY `event_type` = _binary'SESSION_REFRESH'
                AND `subject_account_id` IS NOT NULL
                AND `session_id` IS NOT NULL
                AND `role_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
                AND (
                    (
                        BINARY `outcome` = _binary'SUCCEEDED'
                        AND `actor_account_id` IS NOT NULL
                        AND `actor_account_id` = `subject_account_id`
                    )
                    OR (
                        BINARY `outcome` = _binary'REJECTED'
                        AND `actor_account_id` IS NULL
                    )
                )
            )
            OR (
                BINARY `event_type` = _binary'LOGOUT'
                AND `actor_account_id` IS NOT NULL
                AND `subject_account_id` IS NOT NULL
                AND `actor_account_id` = `subject_account_id`
                AND `role_id` IS NULL
                AND `session_id` IS NOT NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
            )
            OR (
                BINARY `event_type` = _binary'SESSION_FAMILY_REVOCATION'
                AND `subject_account_id` IS NOT NULL
                AND `role_id` IS NULL
                AND `session_id` IS NOT NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
            )
            OR (
                BINARY `event_type` = _binary'PASSWORD_AUTHENTICATOR_DISABLE'
                AND `actor_account_id` IS NULL
                AND `subject_account_id` IS NOT NULL
                AND `role_id` IS NULL
                AND `session_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
            )
            OR (
                BINARY `event_type` = _binary'PASSWORD_AUTHENTICATOR_REBIND'
                AND `actor_account_id` IS NULL
                AND `subject_account_id` IS NOT NULL
                AND `role_id` IS NULL
                AND `session_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NOT NULL
            )
            OR (
                BINARY `event_type` = _binary'PASSWORD_REPLACEMENT'
                AND `actor_account_id` IS NOT NULL
                AND `subject_account_id` IS NOT NULL
                AND `actor_account_id` = `subject_account_id`
                AND `role_id` IS NULL
                AND `session_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
            )
            OR (
                BINARY `event_type` IN (
                    _binary'ACCOUNT_CREATION',
                    _binary'ACCOUNT_SUSPENSION',
                    _binary'ACCOUNT_RESUMPTION',
                    _binary'ACCOUNT_DEACTIVATION'
                )
                AND `actor_account_id` IS NOT NULL
                AND `subject_account_id` IS NOT NULL
                AND `role_id` IS NULL
                AND `session_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
            )
            OR (
                BINARY `event_type` IN (
                    _binary'ROLE_CREATION',
                    _binary'ROLE_RENAME',
                    _binary'ROLE_RETIREMENT'
                )
                AND `actor_account_id` IS NOT NULL
                AND `subject_account_id` IS NULL
                AND `role_id` IS NOT NULL
                AND `session_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
            )
            OR (
                BINARY `event_type` IN (
                    _binary'ROLE_PERMISSION_GRANT',
                    _binary'ROLE_PERMISSION_REVOKE'
                )
                AND `actor_account_id` IS NOT NULL
                AND `subject_account_id` IS NULL
                AND `role_id` IS NOT NULL
                AND `session_id` IS NULL
                AND `permission_code` IS NOT NULL
                AND `operator_reference` IS NULL
            )
            OR (
                BINARY `event_type` IN (
                    _binary'ACCOUNT_ROLE_GRANT',
                    _binary'ACCOUNT_ROLE_REVOKE'
                )
                AND `actor_account_id` IS NOT NULL
                AND `subject_account_id` IS NOT NULL
                AND `role_id` IS NOT NULL
                AND `session_id` IS NULL
                AND `permission_code` IS NULL
                AND `operator_reference` IS NULL
            )
        ),

    INDEX `ix_identity_security_events_time` (`occurred_at`, `id`),
    INDEX `ix_identity_security_events_subject_time` (`subject_account_id`, `occurred_at`, `id`),
    INDEX `ix_identity_security_events_session_time` (`session_id`, `occurred_at`, `id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- AddForeignKey
ALTER TABLE `identity_role_permissions`
    ADD CONSTRAINT `fk_identity_role_permissions_role`
    FOREIGN KEY (`role_id`) REFERENCES `identity_roles` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `identity_role_permissions`
    ADD CONSTRAINT `fk_identity_role_permissions_permission`
    FOREIGN KEY (`permission_code`) REFERENCES `identity_permissions` (`code`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `identity_account_roles`
    ADD CONSTRAINT `fk_identity_account_roles_account`
    FOREIGN KEY (`account_id`) REFERENCES `identity_accounts` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `identity_account_roles`
    ADD CONSTRAINT `fk_identity_account_roles_role`
    FOREIGN KEY (`role_id`) REFERENCES `identity_roles` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Seed immutable application-owned policy. Future permission migrations must
-- prove the complete registry remains within the 128-code authority bound.
INSERT INTO `identity_permissions` (`code`, `description`) VALUES
    (_ascii'audit.records.read', _utf8mb4'Read immutable audit records.'),
    (_ascii'catalog.products.publish', _utf8mb4'Change catalog product publication lifecycle.'),
    (_ascii'catalog.products.read', _utf8mb4'Read catalog product administration data.'),
    (_ascii'catalog.products.write', _utf8mb4'Create and rename catalog products.'),
    (_ascii'catalog.skus.publish', _utf8mb4'Change catalog SKU publication lifecycle.'),
    (_ascii'catalog.skus.read', _utf8mb4'Read catalog SKU administration data.'),
    (_ascii'catalog.skus.write', _utf8mb4'Create and update catalog SKUs.');

INSERT INTO `identity_roles` (
    `id`, `code`, `display_name`, `status`, `version`,
    `created_at`, `updated_at`, `retired_at`
) VALUES (
    UNHEX('01a02f59a80070008000000000000001'),
    _ascii'SYSTEM_ADMINISTRATOR',
    _utf8mb4'System Administrator',
    _ascii'ACTIVE',
    1,
    '2026-08-23 16:00:00.000000',
    '2026-08-23 16:00:00.000000',
    NULL
);

INSERT INTO `identity_role_permissions` (`role_id`, `permission_code`) VALUES
    (UNHEX('01a02f59a80070008000000000000001'), _ascii'audit.records.read'),
    (UNHEX('01a02f59a80070008000000000000001'), _ascii'catalog.products.publish'),
    (UNHEX('01a02f59a80070008000000000000001'), _ascii'catalog.products.read'),
    (UNHEX('01a02f59a80070008000000000000001'), _ascii'catalog.products.write'),
    (UNHEX('01a02f59a80070008000000000000001'), _ascii'catalog.skus.publish'),
    (UNHEX('01a02f59a80070008000000000000001'), _ascii'catalog.skus.read'),
    (UNHEX('01a02f59a80070008000000000000001'), _ascii'catalog.skus.write');
