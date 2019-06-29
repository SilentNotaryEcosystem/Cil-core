FROM nikolaik/python-nodejs:python2.7-nodejs10

RUN mkdir /app/
WORKDIR /app/

COPY . /app/
RUN npm install

CMD node index.js

EXPOSE 8222
EXPOSE 18222
EXPOSE 8223
EXPOSE 18223
