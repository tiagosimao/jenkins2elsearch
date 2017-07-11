# mondego
Development support systems to Elasticsearch data migration

## How to run
* Checkout this repo
* Run npm install
* Create a config.json file (example below)
* Run node mondego.js config.json

### Configuration
```json
{
  "writer": {
    "module": "elasticsearch",
    "settings": {
      "url": "https://somewhere",
      "index": "devopt"
    }
  },
  "drivers": [
    {
      "id": "gitlab-v4",
      "module": "./drivers/gitlab-v4",
      "settings": {
        "url": "https://somewhere/api/v3",
        "username": "bigus_dicus",
        "password": "hunter2"
      }
    },
    {
      "id": "jenkins-v2",
      "module": "./drivers/jenkins-v2",
      "settings": {
        "url": "https://bigus_dicus:hunter2@somewhere/jenkins"
      }
    },
    {
      "id": "jenkins-promoted-builds-v2",
      "module": "./drivers/jenkins-promoted-builds-v2",
      "settings": {
        "url": "https://bigus_dicus:hunter2@somewhere/jenkins"
      }
    }
  ]
}
```
