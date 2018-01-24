space: /\s/
alpha: /[a-z]/i
digit: /\d/

(0):  space ? (0)
      alpha ? (10)
      digit ? (20)
      "+" ? ["+"]
      '"' ? (30)
      !["unknown"]
(10): digit ? (10)
      "." ? (11)
      ["int"]
(11): digit ? (12)
      !["float"]
(12): digit ? (12)
      ["float"]
(20): alpha ? (20)
      ["lookup"]
(30): "\\" ? (31)
      '"' ? ["string"]
      * ? (30)
      !["string"]
(31): * ? (30)
      !["string"]
