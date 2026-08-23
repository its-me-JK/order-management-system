-- Test-only faults for the disposable Identity refresh integration database.
-- The application principal receives no trigger privilege. Each AFTER trigger
-- is root-installed and is inert outside its exact dedicated fixture UUIDs.

DELIMITER //

DROP PROCEDURE IF EXISTS `oms_test_assert_refresh_rollback_database`//
CREATE PROCEDURE `oms_test_assert_refresh_rollback_database`()
SQL SECURITY INVOKER
BEGIN
    IF DATABASE() IS NULL
        OR BINARY DATABASE() <> BINARY 'oms_identity_refresh_locked_loader_integration'
    THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'oms-test refresh rollback fixture requires its disposable database';
    END IF;
END//

CALL `oms_test_assert_refresh_rollback_database`()//
DROP PROCEDURE `oms_test_assert_refresh_rollback_database`//

DROP TRIGGER IF EXISTS `oms_test_refresh_rotation_after_refresh_update`//
CREATE TRIGGER `oms_test_refresh_rotation_after_refresh_update`
AFTER UPDATE ON `identity_refresh_credentials`
FOR EACH ROW
BEGIN
    -- Fixture 101: fail only the predecessor's unconsumed-to-consumed update.
    IF NEW.`id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010103', 0)
        AND NEW.`family_id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010102', 0)
        AND OLD.`consumed_at` IS NULL
        AND NEW.`consumed_at` IS NOT NULL
        AND OLD.`successor_id` IS NULL
        AND NEW.`successor_id` IS NULL
        AND OLD.`active_slot` = 1
        AND NEW.`active_slot` IS NULL
    THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'oms-test refresh rotation fault after predecessor consume';
    -- Fixture 104: fail only the consumed predecessor's successor link.
    ELSEIF NEW.`id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010403', 0)
        AND NEW.`family_id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010402', 0)
        AND OLD.`consumed_at` <=> NEW.`consumed_at`
        AND OLD.`consumed_at` IS NOT NULL
        AND OLD.`successor_id` IS NULL
        AND NEW.`successor_id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010407', 0)
        AND OLD.`active_slot` IS NULL
        AND NEW.`active_slot` IS NULL
    THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'oms-test refresh rotation fault after predecessor link';
    END IF;
END//

DROP TRIGGER IF EXISTS `oms_test_refresh_rotation_after_refresh_insert`//
CREATE TRIGGER `oms_test_refresh_rotation_after_refresh_insert`
AFTER INSERT ON `identity_refresh_credentials`
FOR EACH ROW
BEGIN
    -- Fixture 102: the initial predecessor has a different exact identifier.
    IF NEW.`id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010207', 0)
        AND NEW.`family_id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010202', 0)
    THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'oms-test refresh rotation fault after successor insert';
    END IF;
END//

DROP TRIGGER IF EXISTS `oms_test_refresh_rotation_after_access_insert`//
CREATE TRIGGER `oms_test_refresh_rotation_after_access_insert`
AFTER INSERT ON `identity_access_credentials`
FOR EACH ROW
BEGIN
    -- Fixture 103: fail only the new generation-bound access credential.
    IF NEW.`id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010308', 0)
        AND NEW.`family_id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010302', 0)
    THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'oms-test refresh rotation fault after access insert';
    END IF;
END//

DROP TRIGGER IF EXISTS `oms_test_refresh_rotation_after_family_update`//
CREATE TRIGGER `oms_test_refresh_rotation_after_family_update`
AFTER UPDATE ON `identity_session_families`
FOR EACH ROW
BEGIN
    -- Fixture 105: fail only an otherwise-valid rotation version advance.
    IF NEW.`id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010502', 0)
        AND NEW.`account_id` = OLD.`account_id`
        AND NEW.`version` = OLD.`version` + 1
        AND NEW.`last_rotated_at` > OLD.`last_rotated_at`
        AND NEW.`revoked_at` IS NULL
        AND NEW.`closed_reason` IS NULL
    THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'oms-test refresh rotation fault after family advance';
    END IF;
END//

DROP TRIGGER IF EXISTS `oms_test_refresh_rotation_after_event_insert`//
CREATE TRIGGER `oms_test_refresh_rotation_after_event_insert`
AFTER INSERT ON `identity_security_events`
FOR EACH ROW
BEGIN
    -- Fixture 107: fail only the successful rotation's final security event.
    IF NEW.`id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010706', 0)
        AND NEW.`session_id` = UUID_TO_BIN('01890f3a-8bcd-7def-8abc-000000010702', 0)
        AND BINARY NEW.`event_type` = BINARY 'SESSION_REFRESH'
        AND BINARY NEW.`outcome` = BINARY 'SUCCEEDED'
    THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'oms-test refresh rotation fault after final event insert';
    END IF;
END//

DELIMITER ;
