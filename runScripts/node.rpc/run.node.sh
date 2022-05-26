#!/usr/bin/env bash

CONTAINER_NAME=$1
CONTAINER_NAME="${CONTAINER_NAME:-cil-rpc}"

sudo docker run \
--restart always \
-d \
-p 8222:8222 -p 8223:8223 \
--env-file sample.node.env \
-e AUTO_UPDATE=true \
--name $CONTAINER_NAME \
trueshura/cil-core-prod:rpc
