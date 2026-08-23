-- Identity session lineage is intentionally landed before its persistence
-- adapter. These tables are unused until a reviewed Unit of Work can commit
-- state, authority projection, and security events on one connection.

-- CreateTable
CREATE TABLE `identity_accounts` (
    `id` BINARY(16) NOT NULL,
    `login_name` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    `status` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(6) NOT NULL,
    `updated_at` DATETIME(6) NOT NULL,
    `suspended_at` DATETIME(6) NULL,
    `deactivated_at` DATETIME(6) NULL,

    CONSTRAINT `ck_identity_accounts_id_uuidv7`
        CHECK (
            (ORD(SUBSTRING(`id`, 7, 1)) & 240) = 112
            AND (ORD(SUBSTRING(`id`, 9, 1)) & 192) = 128
        ),
    CONSTRAINT `ck_identity_accounts_login_name`
        CHECK (
            `login_name` IS NULL
            OR REGEXP_LIKE(
                `login_name`,
                _ascii'^[a-z0-9][a-z0-9._-]{2,63}\\z',
                _ascii'c'
            )
        ),
    CONSTRAINT `ck_identity_accounts_status`
        CHECK (
            BINARY `status` IN (
                _binary'ACTIVE',
                _binary'SUSPENDED',
                _binary'DEACTIVATED'
            )
        ),
    CONSTRAINT `ck_identity_accounts_version`
        CHECK (`version` >= 1),
    CONSTRAINT `ck_identity_accounts_timestamp_order`
        CHECK (
            `updated_at` >= `created_at`
            AND (
                `suspended_at` IS NULL
                OR (
                    `suspended_at` >= `created_at`
                    AND `suspended_at` <= `updated_at`
                )
            )
            AND (
                `deactivated_at` IS NULL
                OR (
                    `deactivated_at` >= `created_at`
                    AND `deactivated_at` <= `updated_at`
                )
            )
        ),
    CONSTRAINT `ck_identity_accounts_lifecycle`
        CHECK (
            (
                BINARY `status` = _binary'ACTIVE'
                AND `login_name` IS NOT NULL
                AND MOD(`version`, 2) = 1
                AND `suspended_at` IS NULL
                AND `deactivated_at` IS NULL
                AND (`version` <> 1 OR `updated_at` = `created_at`)
            )
            OR (
                BINARY `status` = _binary'SUSPENDED'
                AND `login_name` IS NOT NULL
                AND `version` >= 2
                AND MOD(`version`, 2) = 0
                AND `suspended_at` IS NOT NULL
                AND `suspended_at` = `updated_at`
                AND `deactivated_at` IS NULL
            )
            OR (
                BINARY `status` = _binary'DEACTIVATED'
                AND `version` >= 2
                AND `suspended_at` IS NULL
                AND `deactivated_at` IS NOT NULL
                AND (
                    (
                        `login_name` IS NOT NULL
                        AND `deactivated_at` = `updated_at`
                    )
                    OR (`login_name` IS NULL AND `version` >= 3)
                )
            )
        ),

    UNIQUE INDEX `uq_identity_accounts_login_name` (`login_name`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `identity_session_families` (
    `id` BINARY(16) NOT NULL,
    `account_id` BINARY(16) NOT NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `created_at` DATETIME(6) NOT NULL,
    `last_rotated_at` DATETIME(6) NOT NULL,
    `idle_expires_at` DATETIME(6) NOT NULL,
    `absolute_expires_at` DATETIME(6) NOT NULL,
    `revoked_at` DATETIME(6) NULL,
    `closed_reason` VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,

    CONSTRAINT `ck_identity_session_families_id_uuidv7`
        CHECK (
            (ORD(SUBSTRING(`id`, 7, 1)) & 240) = 112
            AND (ORD(SUBSTRING(`id`, 9, 1)) & 192) = 128
        ),
    CONSTRAINT `ck_identity_session_families_version`
        CHECK (`version` >= 1),
    CONSTRAINT `ck_identity_session_families_closed_reason`
        CHECK (
            `closed_reason` IS NULL
            OR BINARY `closed_reason` IN (
                _binary'LOGOUT',
                _binary'SESSION_LIMIT_REACHED',
                _binary'ACCOUNT_SUSPENDED',
                _binary'ACCOUNT_DEACTIVATED',
                _binary'PASSWORD_REPLACED',
                _binary'PASSWORD_REBOUND',
                _binary'REFRESH_REUSE_DETECTED'
            )
        ),
    CONSTRAINT `ck_identity_session_families_timestamp_order`
        CHECK (
            `created_at` <= `last_rotated_at`
            AND `last_rotated_at` < `idle_expires_at`
            AND `idle_expires_at` <= `absolute_expires_at`
            AND (`revoked_at` IS NULL OR `revoked_at` >= `last_rotated_at`)
        ),
    CONSTRAINT `ck_identity_session_families_absolute_lifetime`
        CHECK (
            TIMESTAMPDIFF(
                MICROSECOND,
                `created_at`,
                `absolute_expires_at`
            ) BETWEEN 86400000000 AND 2592000000000
            AND MOD(
                TIMESTAMPDIFF(
                    MICROSECOND,
                    `created_at`,
                    `absolute_expires_at`
                ),
                1000000
            ) = 0
        ),
    CONSTRAINT `ck_identity_session_families_idle_lifetime`
        CHECK (
            TIMESTAMPDIFF(
                MICROSECOND,
                `last_rotated_at`,
                `idle_expires_at`
            ) BETWEEN 1000000 AND 86400000000
            AND (
                `idle_expires_at` = `absolute_expires_at`
                OR (
                    TIMESTAMPDIFF(
                        MICROSECOND,
                        `last_rotated_at`,
                        `idle_expires_at`
                    ) >= 900000000
                    AND MOD(
                        TIMESTAMPDIFF(
                            MICROSECOND,
                            `last_rotated_at`,
                            `idle_expires_at`
                        ),
                        1000000
                    ) = 0
                )
            )
        ),
    CONSTRAINT `ck_identity_session_families_lifecycle`
        CHECK (
            (
                `revoked_at` IS NULL
                AND `closed_reason` IS NULL
                AND `version` <= 4294967294
            )
            OR (
                `revoked_at` IS NOT NULL
                AND `closed_reason` IS NOT NULL
                AND `version` >= 2
            )
        ),
    CONSTRAINT `ck_identity_session_families_reuse_version`
        CHECK (
            `closed_reason` IS NULL
            OR BINARY `closed_reason` <> _binary'REFRESH_REUSE_DETECTED'
            OR `version` >= 3
        ),
    CONSTRAINT `ck_identity_session_families_rotation_reachability`
        CHECK (
            (
                (
                    CAST(`version` AS SIGNED)
                    - 1
                    - IF(`revoked_at` IS NULL, 0, 1)
                ) = 0
                AND `last_rotated_at` = `created_at`
            )
            OR (
                (
                    CAST(`version` AS SIGNED)
                    - 1
                    - IF(`revoked_at` IS NULL, 0, 1)
                ) BETWEEN 1 AND 29
                AND TIMESTAMPDIFF(
                    MICROSECOND,
                    `created_at`,
                    `last_rotated_at`
                ) < (
                    CAST(`version` AS SIGNED)
                    - 1
                    - IF(`revoked_at` IS NULL, 0, 1)
                ) * 86400000000
            )
            OR (
                CAST(`version` AS SIGNED)
                - 1
                - IF(`revoked_at` IS NULL, 0, 1)
            ) >= 30
        ),

    INDEX `ix_identity_session_families_account_authentication` (`account_id`, `revoked_at`, `absolute_expires_at`, `id`),
    INDEX `ix_identity_session_families_absolute_expiry` (`absolute_expires_at`, `id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `identity_refresh_credentials` (
    `id` BINARY(16) NOT NULL,
    `family_id` BINARY(16) NOT NULL,
    `digest` BINARY(32) NOT NULL,
    `sequence` INTEGER UNSIGNED NOT NULL,
    `issued_at` DATETIME(6) NOT NULL,
    `expires_at` DATETIME(6) NOT NULL,
    `consumed_at` DATETIME(6) NULL,
    `successor_id` BINARY(16) NULL,
    `active_slot` TINYINT UNSIGNED NULL,

    CONSTRAINT `ck_identity_refresh_credentials_id_uuidv7`
        CHECK (
            (ORD(SUBSTRING(`id`, 7, 1)) & 240) = 112
            AND (ORD(SUBSTRING(`id`, 9, 1)) & 192) = 128
        ),
    CONSTRAINT `ck_identity_refresh_credentials_sequence`
        CHECK (`sequence` BETWEEN 1 AND 4294967294),
    CONSTRAINT `ck_identity_refresh_credentials_lifetime`
        CHECK (
            TIMESTAMPDIFF(
                MICROSECOND,
                `issued_at`,
                `expires_at`
            ) BETWEEN 1000000 AND 86400000000
        ),
    CONSTRAINT `ck_identity_refresh_credentials_initial_lifetime`
        CHECK (
            `sequence` <> 1
            OR (
                TIMESTAMPDIFF(
                    MICROSECOND,
                    `issued_at`,
                    `expires_at`
                ) BETWEEN 900000000 AND 86400000000
                AND MOD(
                    TIMESTAMPDIFF(
                        MICROSECOND,
                        `issued_at`,
                        `expires_at`
                    ),
                    1000000
                ) = 0
            )
        ),
    CONSTRAINT `ck_identity_refresh_credentials_consumption`
        CHECK (
            `consumed_at` IS NULL
            OR (
                `sequence` < 4294967294
                AND `consumed_at` >= `issued_at`
                AND `consumed_at` < `expires_at`
            )
        ),
    CONSTRAINT `ck_identity_refresh_credentials_successor`
        CHECK (
            `successor_id` IS NULL
            OR (
                `consumed_at` IS NOT NULL
                AND `successor_id` <> `id`
            )
        ),
    CONSTRAINT `ck_identity_refresh_credentials_active_slot`
        CHECK (
            `active_slot` <=> IF(`consumed_at` IS NULL, 1, NULL)
        ),

    UNIQUE INDEX `uq_identity_refresh_credentials_digest` (`digest`),
    UNIQUE INDEX `uq_identity_refresh_credentials_family_sequence` (`family_id`, `sequence`),
    UNIQUE INDEX `uq_identity_refresh_credentials_successor` (`successor_id`),
    UNIQUE INDEX `uq_identity_refresh_credentials_family_active_slot` (`family_id`, `active_slot`),
    INDEX `ix_identity_refresh_credentials_expiry` (`expires_at`, `id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE `identity_access_credentials` (
    `id` BINARY(16) NOT NULL,
    `family_id` BINARY(16) NOT NULL,
    `digest` BINARY(32) NOT NULL,
    `sequence` INTEGER UNSIGNED NOT NULL,
    `issued_at` DATETIME(6) NOT NULL,
    `expires_at` DATETIME(6) NOT NULL,

    CONSTRAINT `ck_identity_access_credentials_id_uuidv7`
        CHECK (
            (ORD(SUBSTRING(`id`, 7, 1)) & 240) = 112
            AND (ORD(SUBSTRING(`id`, 9, 1)) & 192) = 128
        ),
    CONSTRAINT `ck_identity_access_credentials_sequence`
        CHECK (`sequence` BETWEEN 1 AND 4294967294),
    CONSTRAINT `ck_identity_access_credentials_lifetime`
        CHECK (
            TIMESTAMPDIFF(
                MICROSECOND,
                `issued_at`,
                `expires_at`
            ) BETWEEN 1000000 AND 1800000000
        ),

    UNIQUE INDEX `uq_identity_access_credentials_digest` (`digest`),
    UNIQUE INDEX `uq_identity_access_credentials_family_sequence` (`family_id`, `sequence`),
    INDEX `ix_identity_access_credentials_family_expiry` (`family_id`, `expires_at`, `id`),
    INDEX `ix_identity_access_credentials_expiry` (`expires_at`, `id`),
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- AddForeignKey
ALTER TABLE `identity_session_families`
    ADD CONSTRAINT `fk_identity_session_families_account`
    FOREIGN KEY (`account_id`) REFERENCES `identity_accounts` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `identity_refresh_credentials`
    ADD CONSTRAINT `fk_identity_refresh_credentials_family`
    FOREIGN KEY (`family_id`) REFERENCES `identity_session_families` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `identity_refresh_credentials`
    ADD CONSTRAINT `fk_identity_refresh_credentials_successor`
    FOREIGN KEY (`successor_id`) REFERENCES `identity_refresh_credentials` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `identity_access_credentials`
    ADD CONSTRAINT `fk_identity_access_credentials_refresh_generation`
    FOREIGN KEY (`family_id`, `sequence`)
    REFERENCES `identity_refresh_credentials` (`family_id`, `sequence`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
