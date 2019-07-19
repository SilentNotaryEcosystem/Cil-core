#!/usr/bin/env bash

echo "Enter your password for PK (press Ctrl+D when done)"
cat >temp.pk.password
sudo PK_PASSWORD=`cat temp.pk.password` docker run --restart always -d -v `pwd`/sample.pk:/app/private --env-file sample.witness.env -e PK_PASSWORD --name cil-witness trueshura/cil-core-staging:latest
rm temp.pk.password
