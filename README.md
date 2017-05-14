# mondego
Jenkins to Elasticsearch ETL

## How to run
* Checkout this repo
* Run npm install
* Create a config.json file (example below)
* Run node mondego.js config.json

### Configuration
```json
{
  "elasticsearch": {
    "url": "https://somewhere",
    "buildindex": "build",
    "projectindex": "project"
  },
  "jenkins": {
    "url": "https://somewhere/jenkins",
    "username": "bigus_dicus",
    "password": "hunter2"
  },
  "gitlab": {
    "url": "https://somewhere/api/v3",
    "username": "bigus_dicus",
    "password": "hunter2"
  }
}
```
