#!/usr/bin/env bash

# this script will check for new commits at remote, pull changes, restart container

function startProcess() {
  echo "Node started"
  node --max-old-space-size=${MAX_OLD_SPACE_SIZE:-4096} --expose-gc index.js &
  child=$!
}

function restartIfNeeded() {
  echo "Checking is alive ..."
  if ! ps -p $child >/dev/null; then
    echo "Node is dead. Restarting"
    startProcess
  fi
}

function checkForUpdate() {
  echo "Checking for update ..."
  git remote update
  behind=$(git status -uno | grep behind | wc -l | awk '{print $1}')
  [[ $behind == "1" ]] && git pull && _term
}

function justSleep() {
  # это должно быть так, потому что wait - это часть bash, и поскольку управление у него
  # то работает trap. А если sleep без & то обработчик trap не работает
  sleep 5m &
  wait "$!"
}

function _term() {
  echo "Requested CONTAINER SHUTDOWN !"
  kill -TERM "$child" 2>/dev/null
  wait "$child"
  exit 100
}

#------------------------------------------------

startProcess
i=0
trap _term SIGTERM

while :; do
  ((i++))
  restartIfNeeded

  if [[ ${AUTO_UPDATE} == "true" ]] && ! (($i % 6)); then
    checkForUpdate
  fi

  justSleep
done
