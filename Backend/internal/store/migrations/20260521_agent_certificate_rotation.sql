-- Allow enrollment-authorized certificate rotation for the same agent identity.
-- Fingerprints remain globally unique; subject hash becomes a lookup index so
-- revoked and active certificates can share the same spiffe://kn-ig/agent/<id>.

DROP PROCEDURE IF EXISTS knig_drop_index_if_exists;
DROP PROCEDURE IF EXISTS knig_add_index_if_not_exists;

DELIMITER $$

CREATE PROCEDURE knig_drop_index_if_exists(IN p_table_name VARCHAR(64), IN p_index_name VARCHAR(64))
BEGIN
    IF EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @ddl = CONCAT('ALTER TABLE ', p_table_name, ' DROP INDEX ', p_index_name);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

CREATE PROCEDURE knig_add_index_if_not_exists(IN p_table_name VARCHAR(64), IN p_index_name VARCHAR(64), IN p_index_def VARCHAR(1024))
BEGIN
    IF EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
    ) AND NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @ddl = CONCAT('CREATE INDEX ', p_index_def);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

DELIMITER ;

CALL knig_drop_index_if_exists('agent_certificates', 'uq_agent_cert_subject_hash');
CALL knig_add_index_if_not_exists(
    'agent_certificates',
    'idx_agent_cert_subject_hash',
    'idx_agent_cert_subject_hash ON agent_certificates(cert_subject_hash)'
);

DROP PROCEDURE IF EXISTS knig_drop_index_if_exists;
DROP PROCEDURE IF EXISTS knig_add_index_if_not_exists;
