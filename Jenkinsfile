pipeline {
  agent any

  options {
    disableConcurrentBuilds()
    timestamps()
  }

  environment {
    SSH_USER = ''
    SSH_CRED_ID = 'ssh-key-cicduser'
    PROD_SERVER_CRED = 'servername-app1'      // e.g. "prod.example.com"
    PROD_APPDIR_CRED = 'deploypath-nettools-iplookup'          // e.g. "/opt/myapp"
    STAGING_SERVER_CRED = 'servername-app1'
    STAGING_APPDIR_CRED = 'deploypath-nettools-iplookup-sg'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Deploy') {
      when {
        anyOf {
          branch 'main'
          branch 'staging'
        }
      }
      steps {
        script {
          def isProd = (env.BRANCH_NAME == 'main')

          def serverCred = isProd ? env.PROD_SERVER_CRED : env.STAGING_SERVER_CRED
          def appDirCred = isProd ? env.PROD_APPDIR_CRED : env.STAGING_APPDIR_CRED

          // Compose file selection: staging uses docker-compose.staging.yml
          def composeFile = isProd ? 'docker-compose.yml' : 'docker-compose.staging.yml'

          // Compose command: try v2 ("docker compose") then fall back to v1 ("docker-compose")
          // Use single-quoted string to prevent Groovy interpolation - these are bash variables
          def remoteScript = '''
            set -euo pipefail

            cd "$APP_DIR"

            echo "==> Pulling latest code for branch: $BRANCH"
            # Ensure we're on the right branch and up to date
            git fetch --prune
            git checkout "$BRANCH"
            git reset --hard "origin/$BRANCH"

            echo "==> Rebuilding and restarting containers using $COMPOSE_FILE"
            if docker compose version >/dev/null 2>&1; then
              docker compose -f "$COMPOSE_FILE" pull || true
              docker compose -f "$COMPOSE_FILE" build --pull
              docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
            else
              docker-compose -f "$COMPOSE_FILE" pull || true
              docker-compose -f "$COMPOSE_FILE" build --pull
              docker-compose -f "$COMPOSE_FILE" up -d --remove-orphans
            fi

            echo "==> Pruning unused images (safe-ish cleanup)"
            docker image prune -f || true
          '''

          withCredentials([
            string(credentialsId: serverCred, variable: 'SERVER_NAME'),
            string(credentialsId: appDirCred, variable: 'APP_DIR'),
            sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER_FROM_CRED')
          ]) {
            // Prefer username from SSH credential if provided; else fall back to SSH_USER env var
            def sshUser = (env.SSH_USER_FROM_CRED?.trim()) ? env.SSH_USER_FROM_CRED : env.SSH_USER

            // Export vars for the shell step using withEnv (avoids credential exposure warnings)
            withEnv([
              "DEPLOY_BRANCH=${env.BRANCH_NAME}",
              "DEPLOY_APP_DIR=${env.APP_DIR}",
              "DEPLOY_COMPOSE_FILE=${composeFile}",
              "DEPLOY_SERVER=${env.SERVER_NAME}",
              "DEPLOY_SSH_USER=${sshUser}",
              "DEPLOY_SSH_KEY=${env.SSH_KEY}"
            ]) {
              sh '''
                set -euo pipefail
                echo "Deploying branch '${DEPLOY_BRANCH}' to ''' + (isProd ? 'PRODUCTION' : 'STAGING') + ''': ${DEPLOY_SERVER}:${DEPLOY_APP_DIR}"

                ssh -i "${DEPLOY_SSH_KEY}" -o StrictHostKeyChecking=no "${DEPLOY_SSH_USER}@${DEPLOY_SERVER}" \
                  'BRANCH="'"${DEPLOY_BRANCH}"'" APP_DIR="'"${DEPLOY_APP_DIR}"'" COMPOSE_FILE="'"${DEPLOY_COMPOSE_FILE}"'" bash -s' <<'REMOTE'
set -euo pipefail
cd "$APP_DIR"
echo "==> Pulling latest code for branch: $BRANCH"
git fetch --prune
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
echo "==> Rebuilding and restarting containers using $COMPOSE_FILE"
if docker compose version >/dev/null 2>&1; then
  docker compose -f "$COMPOSE_FILE" pull || true
  docker compose -f "$COMPOSE_FILE" build --pull
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
else
  docker-compose -f "$COMPOSE_FILE" pull || true
  docker-compose -f "$COMPOSE_FILE" build --pull
  docker-compose -f "$COMPOSE_FILE" up -d --remove-orphans
fi
echo "==> Pruning unused images (safe-ish cleanup)"
docker image prune -f || true
REMOTE
              '''
            }
          }
        }
      }
    }
  }

  post {
    success {
      echo "Deployment succeeded for ${env.BRANCH_NAME}"
    }
    failure {
      echo "Deployment failed for ${env.BRANCH_NAME}"
    }
  }
}
