#!/usr/bin/env bash

CONTAINER_NAME=$1
CONTAINER_NAME="${CONTAINER_NAME:-cil-witness}"

echo "Enter your password for PK (press Ctrl+D when done)"
cat >temp.pk.password

sudo PK_PASSWORD=`cat temp.pk.password` docker run \
--restart always \
-p 8223:8223 \
-d \
-v $(pwd)/sample.pk:/app/private \
-v $(pwd)/factoryOptions.json:/app/factoryOptions.json \
--env-file sample.witness.env -e PK_PASSWORD \
--name $CONTAINER_NAME \
trueshura/cil-core-prod:latest

rm temp.pk.password
