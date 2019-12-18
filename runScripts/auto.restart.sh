#!/usr/bin/env bash

# this script will check for new commits at remote, pull changes, restart container

function checkForUpdate {
  echo "Checking for update ..."
  git remote update
  behind=`git status -uno | grep behind | wc -l | awk '{print $1}'`
  [[ $behind == "1" ]] && git pull && exit 0
}

node index.js &

if [[ ${AUTO_UPDATE} == "true" ]]; then
    while :; do checkForUpdate; sleep 30m; done
else
    while :; do sleep 60m; done
fi


