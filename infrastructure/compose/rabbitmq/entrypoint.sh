#!/bin/sh

set -eu

secret_path=/run/secrets/rabbitmq_password

if [ ! -r "$secret_path" ]; then
  printf '%s\n' 'RabbitMQ password secret is unavailable.' >&2
  exit 1
fi

password="$(tr -d '\r\n' < "$secret_path")"

if [ -z "$password" ]; then
  printf '%s\n' 'RabbitMQ password secret must not be empty.' >&2
  exit 1
fi

export RABBITMQ_DEFAULT_PASS="$password"
unset password secret_path

exec docker-entrypoint.sh rabbitmq-server
