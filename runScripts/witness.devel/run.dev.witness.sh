#!/usr/bin/env bash

CONTAINER_NAME=$1
CONTAINER_NAME="${CONTAINER_NAME:-cil-witness-devel}"

echo "Enter your password for PK (press Ctrl+D when done)"
cat >temp.pk.password

sudo PK_PASSWORD=`cat temp.pk.password` docker run --restart always \
-p 18223:18223 \
-d \
-v $(pwd)/sample.pk:/app/private \
--env-file sample.witness.env -e DEBUG="node:app, node:messages, node:messages:full" -e NODE_ENV=Devel -e PK_PASSWORD \
--name $CONTAINER_NAME \
trueshura/cil-core-staging:latest

rm temp.pk.password
