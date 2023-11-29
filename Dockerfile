FROM nikolaik/python-nodejs:python3.8-nodejs16

STOPSIGNAL SIGTERM

RUN mkdir /app/
WORKDIR /app/

COPY . /app/
RUN npm install

SHELL ["/bin/bash"]
CMD runScripts/auto.restart.sh

EXPOSE 8222
EXPOSE 18222
EXPOSE 8223
EXPOSE 18223
