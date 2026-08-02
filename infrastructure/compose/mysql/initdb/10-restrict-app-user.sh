# This file is sourced by the official MySQL entrypoint after it creates the
# database and application user. The entrypoint provides docker_process_sql
# and mysql_error.

case "$MYSQL_DATABASE" in
  '' | *[!a-zA-Z0-9_]*)
    mysql_error 'MYSQL_DATABASE must contain only letters, digits, and underscores'
    ;;
esac

case "$MYSQL_USER" in
  '' | *[!a-zA-Z0-9_]*)
    mysql_error 'MYSQL_USER must contain only letters, digits, and underscores'
    ;;
esac

# MySQL treats underscores in database-level grants as pattern wildcards, so
# escape them even though the identifier itself is quoted.
oms_database_grant_name="${MYSQL_DATABASE//_/\\_}"

docker_process_sql --database=mysql <<-EOSQL
  REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${MYSQL_USER}'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE ON \`${oms_database_grant_name}\`.* TO '${MYSQL_USER}'@'%';
EOSQL

unset oms_database_grant_name
