#!/usr/bin/env bash

# this script will check for new commits at remote, pull changes, restart container

node index.js

if [[ ${AUTO_UPDATE} == "true" ]]; then
    while :; do checkForUpdate; sleep 3600; done
fi


function checkForUpdate {
  git remote update
  behind=`git status -uno | grep behind | wc -l | awk '{print $1}'`
  [[ $behind$ == "1" ]] && git pull && pkill bash
}
