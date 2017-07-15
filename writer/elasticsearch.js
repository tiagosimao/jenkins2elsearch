const elasticsearch = require('elasticsearch');

module.exports.setup = function(settings){
  return new Promise((ff,rj)=>{
    setup(settings,ff,rj);
  });
};
module.exports.write = function(type,data){
  return new Promise((ff,rj)=>{
    data.type= type,
    elclient.index({
      "index": index,
      "type": "doc",
      "id": data.id,
      "body": data },
      (err,ok)=>{
        if(err){
          console.error("Error writing to elasticsearch: " + err);
          rj(err);
        } else {
          //console.log("Wrote on index=" + index + ", type=" + type);
          ff(ok);
        }
      });
    });
  };

let elclient;
let index;

function setup(settings,ff,rj) {
  elclient = new elasticsearch.Client({
    host: settings.url,
    log: 'info'
  });
  index = settings.index;
  elclient.indices.exists({
    "index": index,
  }, (err,ok)=>{
    if (err) {
      rj("Error finding index in Elasticsearch: " + err);
    }
    if(ok) {
      ff("Found index " + index + " in Elasticsearch: " + ok);
    } else {
      console.log("Index " + index + " not found")
      elclient.indices.create({
        "index": index,
      }
      ,(err,ok)=>{
        if (err) {
          rj("Error creating index " + index + " in Elasticsearch: " + err);
        }
        putMapping(index).then(
          ok=>{
            console.log("Mappings created");
            ff()
          },
          ko=>{
            console.log("Error creating mappings");
            rj();
          }
        );
      });
    }
  });
}

function putMapping(index) {
  return new Promise((ff,rj)=>{
    elclient.indices.putMapping({
      "index": index,
      "type": "doc",
      "body": {
        "properties": {
          "id": { "type": "text" }
        }
      }
    },(err,ok)=>{
      if (err) {
        console.log("Error creating mappings in " + index + ": " + err);
        rj();
      } else {
        console.log("Created mappings in " + index + ": " + ok);
        ff();
      }
    });
  });
}
