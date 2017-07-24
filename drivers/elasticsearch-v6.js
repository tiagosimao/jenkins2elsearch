const elasticsearch = require('elasticsearch');

module.exports.setup = function(settings){
  return new Promise((ff,rj)=>{
    setup(settings,ff,rj);
  });
};
module.exports.getState = function(){
  return new Promise((ff,rj)=>{
    elclient.get({
      index: index,
      type: elType,
      id: stateId
    }, function (error, response) {
      if(error){
        rj("Error loading mondego's state: " + error);
      } else {
        ff(response._source);
      }
    });
  });
};
module.exports.setState = function(state){
  return new Promise((ff,rj)=>{
    pendingSaveState=state;
    saveState();
  });
};
module.exports.write = function(cursor,input){
  return new Promise((ff,rj)=>{
    elclient.index({
      "index": index,
      "type": elType,
      "id": input.id,
      "body": input },
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

const elType = "doc";
const stateId = "mondegoState";
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
  }, (err,response)=>{
    if (err) {
      rj("Error finding index in Elasticsearch: " + err);
    }
    if(response) {
      ff("Found index " + index + " in Elasticsearch: " + response);
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

let pendingSaveState;
let lastSave = Date.now();
let lastElapsed = 1000;

function saveState(){
  const start = Date.now();
  if(start-lastSave>lastElapsed*10) {
    lastSave=start;
    //console.log("Last save was at " + lastSave + ", it's now " + start + ", more than " + (lastElapsed*10) + " has passed");
    //console.log("actually saving state: " + JSON.stringify(pendingSaveState));
    elclient.index({
      "index": index,
      "type": elType,
      "id": stateId,
      "body": pendingSaveState },
      (err,ok)=>{
        if(err){
          console.error("Error writing to elasticsearch: " + err);
        } else {
          //console.log("Wrote on index=" + index + ", type=" + type);
          lastElapsed=Date.now()-start;
          //console.log("Last save state took " + lastElapsed)
        }
      });
    }
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
