pipeline {
    agent any

    tools {
        nodejs 'Node JS'
    }

    environment {
        BOT_TOKEN = credentials('bot_token')
        OPENAI_API_KEY = credentials('openai_api_key')
        LOCAL_CHAT_ID = credentials('local_chat_id')
        IS_ALIVE = credentials('is_alive')
        CHAT_ID = credentials('chat_id')
        REDIS_URL = credentials('redis_url')
        BOT_USERNAME = credentials('bot_username')
        TIMEOUT = credentials('timeout')
        MODEL_NAME = credentials('model_name')
    }

    stages {
        stage('Install Dependencies') {
            steps {
                script {
                    sh '/home/user/.nvm/versions/node/v20.15.0/bin/pnpm install'
                }
            }
        }
        stage('Start Application') {
            steps {
                script {
                    sh '/home/user/.nvm/versions/node/v20.15.0/bin/pm2 stop reals-bot || true'
                    sh '/home/user/.nvm/versions/node/v20.15.0/bin/pm2 delete reals-bot || true'
                    sh '/home/user/.nvm/versions/node/v20.15.0/bin/pm2 start npm --name "reals-bot" -- start'
                    sh '/home/user/.nvm/versions/node/v20.15.0/bin/pm2 save'
                }
            }
        }
    }
}