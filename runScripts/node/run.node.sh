sudo docker run --restart always -d -p 8222:8222 -p 8223:8223 --env-file sample.node.env --name cil-node trueshura/cil-core-prod:latest
