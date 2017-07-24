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
  "destinationDriver": {
    "module": "./drivers/elasticsearch-v6",
    "settings": {
      "url": "localhost:9200",
      "index": "mydevdata"
    }
  },
  "stateDriver": {
    "module": "./drivers/elasticsearch-v6",
    "settings": {
      "url": "localhost:9200",
      "index": "mondego"
    }
  },
  "sourceDrivers": [
    {
      "id": "gitlab-v4",
      "module": "./drivers/gitlab-v4",
      "workers": 4,
      "settings": {
        "url": "https://somewhere/api/v3",
        "username": "bigus_dicus",
        "password": "hunter2"
      }
    },
    {
      "id": "jenkins-v2",
      "module": "./drivers/jenkins-v2",
      "workers": 1,
      "settings": {
        "url": "https://bigus_dicus:hunter2@somewhere/jenkins"
      }
    },
    {
      "id": "jenkins-promoted-builds-v2",
      "module": "./drivers/jenkins-promoted-builds-v2",
      "workers": 1,
      "settings": {
        "url": "https://bigus_dicus:hunter2@somewhere/jenkins"
      }
    }
  ]
}
```
