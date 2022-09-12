FROM node:16-alpine

ARG REFRESHED_AT
ENV REFRESHED_AT $REFRESHED_AT

RUN apk -U upgrade \
    && apk add --no-cache \
    procps \
    git \
    openssh \
    bash

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
