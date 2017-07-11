const elasticsearch = require('elasticsearch');

module.exports.setup = function(settings){
  return new Promise((ff,rj)=>{
    setup(settings,ff,rj);
  });
};
module.exports.write = function(type,data){
  return new Promise((ff,rj)=>{
    if(data && data.length){
      for(let i=0;i<data.length;++i){
        let o = {
          "index":index,
          "type": type,
          "id": data[i].id,
          "body": data[i]
        };
        elclient.index(o,(err,ok)=>{
          if(err){
            console.error("Error writing to elasticsearch: " + err);
          }
        });
      }
    } else if(data) {
      elclient.index({
          "index": index,
          "type": type,
          "id": data.id,
          "body": data
      });
    }
    ff();
  });
};

let elclient;
let index;

function setup(settings,ff,rj) {
  elclient = new elasticsearch.Client({
      host: settings.url,
      log: 'info'
  });
  /*
  PUT devopt2
{
  "mappings": {
    "repo": {
      "properties": {
        "id":    { "type": "text"  }
      }
    },
    "commit": {
      "properties": {
        "id":    { "type": "text"  }
      }
    }
  }
}
*/
  index = settings.index;
  elclient.ping({
      requestTimeout: 1000
  }, function (error) {
      if (error) {
          rj("Error connecting to Elasticsearch");
      } else {
          ff("Loaded mondego writer (elasticsearch)");
      }
  });
}
