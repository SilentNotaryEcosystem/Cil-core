#!/usr/bin/env bash

CONTAINER_NAME=$1
CONTAINER_NAME="${CONTAINER_NAME:-cil-node-devel}"

sudo docker run \
--restart always \
-d \
-p 18222:18222 -p 18223:18223 \
--env-file sample.node.env \
--name $CONTAINER_NAME \
trueshura/cil-core-staging:latest
