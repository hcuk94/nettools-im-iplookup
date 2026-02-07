# Jenkins Agent with Docker Access

Docker-outside-of-Docker (DooD) agent for building images in Jenkins.

## Build

```bash
docker build -t jenkins-agent-docker:latest jenkins-agent/
```

## Usage

Run with Docker socket mounted:

```bash
docker run -d \
  --name jenkins-agent \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e JENKINS_URL=http://jenkins:8080 \
  -e JENKINS_SECRET=xxx \
  -e JENKINS_AGENT_NAME=docker-agent-1 \
  jenkins-agent-docker:latest
```

In Jenkins, configure agent with label `docker-builder` and use in pipeline:

```groovy
agent { label 'docker-builder' }
```
