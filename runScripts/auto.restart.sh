#!/usr/bin/env bash

_term() {
  echo "Requested CONTAINER SHUTDOWN !"
  kill -TERM "$child" 2>/dev/null
  wait "$child"
  exit 100
}
trap _term SIGTERM


# this script will check for new commits at remote, pull changes, restart container

function checkForUpdate {
  echo "Checking for update ..."
  git remote update
  behind=`git status -uno | grep behind | wc -l | awk '{print $1}'`
  [[ $behind == "1" ]] && git pull && exit 0
}

function justSleep {
    sleep 30m &
    wait "$!"
}

node index.js &
child=$!

if [[ ${AUTO_UPDATE} == "true" ]]; then
    while :; do checkForUpdate; justSleep; done
else
    while :; do justSleep; done
fi


