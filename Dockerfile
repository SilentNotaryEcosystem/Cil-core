FROM nikolaik/python-nodejs:python2.7-nodejs10

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
