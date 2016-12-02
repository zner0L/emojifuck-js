document.addEventListener('DOMContentLoaded', function() {
  window.code_field = document.getElementById('code');
  window.input_field = document.getElementById('input');
  window.output_field = document.getElementById('output');
  
  /* ================== BF Worker ================ */
  
      if(typeof(Worker) == "undefined") {
          output_field.value = ("No Web Worker support found in browser. Sorry, cannot run the interpreter!");
      }
      window.emojisfucked = new Worker("emojisfucked.js");
  
      window.emojisfucked.onmessage = function(event){
          var data = event.data;
  
          switch (data.command) {
              case "print": {
                  output_field.value += data.value;
                  break;
              }
              case "read": {
                  break;
              }
              case "error": {
                  output_field.value = '<span style="color: red;">Error: </span>' + data.message;
                  break;
              }
              case "fin": {
                  break;
              }
              default:
                  break;
          }
      };
  /* ================== End of BF Worker ================ */

  var code_form = document.getElementById('code_form');
  code_form.onsubmit = function(e) {
      output_field.value = '';
    e.preventDefault()
        var program = code_field.value
      window.emojisfucked.postMessage({ "command": "run", "program": program, "input": input_field.value, "optimize": false });
  }
});
