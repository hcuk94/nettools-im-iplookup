pipeline {
  agent any

  options {
    disableConcurrentBuilds()
    timestamps()
  }

  environment {
    SSH_USER = ''
    SSH_CRED_ID = 'ssh-key-cicduser'
    PROD_SERVER_CRED = 'servername-app1'
    PROD_APPDIR_CRED = 'deploypath-nettools-iplookup'
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
          env.DEPLOY_COMPOSE_FILE = isProd ? 'docker-compose.yml' : 'docker-compose.staging.yml'
          env.DEPLOY_TARGET = isProd ? 'PRODUCTION' : 'STAGING'
        }

        // Bind credentials to environment variables securely
        withCredentials([
          string(credentialsId: env.PROD_SERVER_CRED, variable: 'PROD_SERVER'),
          string(credentialsId: env.PROD_APPDIR_CRED, variable: 'PROD_APPDIR'),
          string(credentialsId: env.STAGING_SERVER_CRED, variable: 'STAGING_SERVER'),
          string(credentialsId: env.STAGING_APPDIR_CRED, variable: 'STAGING_APPDIR'),
          sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY_FILE', usernameVariable: 'SSH_USER_CRED')
        ]) {
          sh '''
            set -euo pipefail

            # Determine target based on branch
            if [ "$BRANCH_NAME" = "main" ]; then
              DEPLOY_SERVER="$PROD_SERVER"
              DEPLOY_APPDIR="$PROD_APPDIR"
            else
              DEPLOY_SERVER="$STAGING_SERVER"
              DEPLOY_APPDIR="$STAGING_APPDIR"
            fi

            # Use SSH_USER from credential if available, otherwise fall back to env
            SSH_USER_TO_USE="${SSH_USER_CRED:-$SSH_USER}"

            echo "==> Deploying branch '$BRANCH_NAME' to $DEPLOY_TARGET: $DEPLOY_SERVER:$DEPLOY_APPDIR"

            ssh -i "$SSH_KEY_FILE" -o StrictHostKeyChecking=no "$SSH_USER_TO_USE@$DEPLOY_SERVER" <<REMOTE_EOF
set -euo pipefail
cd "$DEPLOY_APPDIR"

echo "==> Pulling latest code for branch: $BRANCH_NAME"
git fetch --prune
git checkout "$BRANCH_NAME"
git reset --hard "origin/$BRANCH_NAME"

echo "==> Rebuilding and restarting containers using $DEPLOY_COMPOSE_FILE"
if docker compose version >/dev/null 2>&1; then
  docker compose -f "$DEPLOY_COMPOSE_FILE" pull || true
  docker compose -f "$DEPLOY_COMPOSE_FILE" build --pull
  docker compose -f "$DEPLOY_COMPOSE_FILE" up -d --remove-orphans
else
  docker-compose -f "$DEPLOY_COMPOSE_FILE" pull || true
  docker-compose -f "$DEPLOY_COMPOSE_FILE" build --pull
  docker-compose -f "$DEPLOY_COMPOSE_FILE" up -d --remove-orphans
fi

echo "==> Pruning unused images (safe-ish cleanup)"
docker image prune -f || true
REMOTE_EOF
          '''
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
