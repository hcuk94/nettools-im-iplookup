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

          // Compose command: try v2 ("docker compose") then fall back to v1 ("docker-compose")
          // You can also swap in different compose files per branch if needed.
          def remoteScript = """
            set -euo pipefail

            cd "${APP_DIR}"

            echo "==> Pulling latest code for branch: ${BRANCH}"
            # Ensure we're on the right branch and up to date
            git fetch --prune
            git checkout "${BRANCH}"
            git reset --hard "origin/${BRANCH}"

            echo "==> Rebuilding and restarting containers"
            if docker compose version >/dev/null 2>&1; then
              docker compose pull || true
              docker compose build --pull
              docker compose up -d --remove-orphans
            else
              docker-compose pull || true
              docker-compose build --pull
              docker-compose up -d --remove-orphans
            fi

            echo "==> Pruning unused images (safe-ish cleanup)"
            docker image prune -f || true
          """

          withCredentials([
            string(credentialsId: serverCred, variable: 'SERVER_NAME'),
            string(credentialsId: appDirCred, variable: 'APP_DIR'),
            sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER_FROM_CRED')
          ]) {
            // Prefer username from SSH credential if provided; else fall back to SSH_USER env var
            def sshUser = (env.SSH_USER_FROM_CRED?.trim()) ? env.SSH_USER_FROM_CRED : env.SSH_USER

            sh """
              set -euo pipefail
              echo "Deploying branch '${env.BRANCH_NAME}' to ${isProd ? 'PRODUCTION' : 'STAGING'}: ${SERVER_NAME}:${APP_DIR}"

              ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no "${sshUser}@${SERVER_NAME}" \\
                'BRANCH="${env.BRANCH_NAME}" APP_DIR="${APP_DIR}" bash -s' <<'REMOTE'
${remoteScript}
REMOTE
            """
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
