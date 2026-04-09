<?php

// ini_set('display_errors', 1);
// ini_set('display_startup_errors', 1);
// error_reporting(E_ALL);


ini_set('default_charset', 'UTF-8');
header('Content-Type: application/json;charset=UTF-8');

include('env.php');
require_once('vendor/autoload.php');
$request_method =  $_SERVER['REQUEST_METHOD'];

if (isset($_GET['route'])) {

    $route = $_GET['route'];
    $stripe = new \Stripe\StripeClient(STRIPE_KEY);


    if ($route == 'products') {


        $products = getProducts();
        echo json_encode($products);
    } else if ($route == 'payment_intent' && $request_method == 'POST') {

        $json = file_get_contents('php://input');
        $data = json_decode($json);

        $email = $data->receipt_email;
        $donor_name = $data->donor_name;
        $amount = $data->amount;
        $items = $data->items;

        $customer = createCustomer($email, $donor_name);
        $customer_id = $customer['id'];
        $paymentIntent = createPaymentIntent($amount, $customer_id, $email, $items, $donor_name);

        if ($paymentIntent) {
            $ret =  [
                "clientSecret" => $paymentIntent['client_secret']
            ];

            // "paymentIntentId" => $paymentIntent['id'],


            echo json_encode($ret);
        }
    } else if ($route == 'dietary' && $request_method  == 'POST') {
        $json = file_get_contents('php://input');
        $data = json_decode($json);
        $sent = sendEmail($data);
        if ($sent) {
            $ret = ['blah' => 'foo', 'restrictions' => $data->restrictions, 'full_name' => $data->full_name];
            echo json_encode($ret);
        } else {
            echo json_encode(['error' => true]);
        }
    }
}

function sendEmail($data) {
    $subject = 'Wedding dietary requirements';
    $message =  "{$data->full_name} : {$data->restrictions}";
    // $mail =  mail(MAIL_TO, $subject, $message);

    $mail = new PHPMailer\PHPMailer\PHPMailer(true);
    $mail->CharSet = 'UTF-8';
    $mail->isSMTP();                          // Set mailer to use SMTP
    $mail->Host = 'smtp.gmail.com';           // Specify main and backup SMTP servers
    $mail->SMTPAuth = true;                   // Enable SMTP authentication
    $mail->Username = MAIL_USERNAME;          // SMTP username
    $mail->Password = MAIL_PASSWORD;          // SMTP password
    $mail->SMTPSecure = 'tls';                // Enable TLS encryption, `ssl` also accepted
    $mail->Port = 587;
    $mail->Subject =  $subject;
    $mail->Body  = $message;
    $mail->addAddress(MAIL_TO);
    $mail->send();


    return $mail;
}

function createCustomer($email, $name) {
    global $stripe;
    $customer = $stripe->customers->create([
        'email' =>  $email,
        'name' => $name,
    ]);
    return $customer;
}


function createPaymentIntent($amount, $customer_id, $receipt_email, $items, $donor_name) {
    global $stripe;
    $products = array();
    $description = "Wedding gift purchase ";
    foreach ($items as $item) {
        array_push($products, $item->name);
    };
    $description .=  implode(', ', $products);

    $paymentIntent = $stripe->paymentIntents->create([

        'amount' => $amount,
        'receipt_email' => $receipt_email,
        'currency' => "gbp",
        'customer' => $customer_id,
        'description' => $description,
        'metadata' => array("products" =>   implode(', ', $products), "donor" => $donor_name),

    ]);
    return $paymentIntent;
}


function getProducts() {


    // return getTestProducts();


    global $stripe;
    $stripeProducts = $stripe->products->all([
        'limit' => 100,
        'active' => true,
        'expand' => ['data.default_price']
    ]);

    $products = [];


    foreach ($stripeProducts as $sp) {


        // $active = $sp['active'];


        $variable = false;
        $maxPrice = 10000;
        $image = null;
        if ($sp['images']) {
            $image = $sp['images'][0];
        }
        if ($sp['default_price']['custom_unit_amount']) {
            $variable = true;
            if ($sp['default_price']['custom_unit_amount']['maximum']) {
                $maxPrice = $sp['default_price']['custom_unit_amount']['maximum'] / 100;
            }
        }

        $displayPrice = $sp['default_price']['unit_amount'] / 100.0;

        array_push($products, [
            "id" => $sp['id'],
            "name" => $sp['name'],
            "description" => $sp['description'],
            "image" => $image,
            "price" => $displayPrice,
            "price_id" => $sp['default_price'],
            "unit_amount" => $sp['default_price']['unit_amount'],
            "custom_unit_amount" => $sp['default_price']['custom_unit_amount'],
            "variable" => $variable,
            "maxPrice" => $maxPrice,
        ]);
    }
    // shuffle($products);
    usort($products, "sort_price");

    return $products;
}


function sort_price($a, $b) {
    return $a['price'] > $b['price'];
}



function getTestProducts() {

    return  json_decode('[{"id":"prod_TalBoRJpMlSkTk","name":"Donation to Shelter","description":null,"image":null,"price":0,"price_id":{"id":"price_1SdZfWCy1iNbWu3noP9gMhj0","object":"price","active":true,"billing_scheme":"per_unit","created":1765558694,"currency":"gbp","custom_unit_amount":{"maximum":1000000,"minimum":100,"preset":null},"livemode":false,"lookup_key":null,"metadata":[],"nickname":null,"product":"prod_TalBoRJpMlSkTk","recurring":null,"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"one_time","unit_amount":null,"unit_amount_decimal":null},"unit_amount":null,"custom_unit_amount":{"maximum":1000000,"minimum":100,"preset":null},"variable":true,"maxPrice":10000},{"id":"prod_Tak6nAbzZlgVAS","name":"Pepper Mill","description":null,"image":"https://files.stripe.com/links/MDB8YWNjdF8xU2RZYjRDeTFpTmJXdTNufGZsX3Rlc3RfbmlZT1F3aXBPQ0dURklwVGNhWUFJWFlw00yYPlmEgG","price":25,"price_id":{"id":"price_1SdYc6Cy1iNbWu3npgpTVzXm","object":"price","active":true,"billing_scheme":"per_unit","created":1765554638,"currency":"gbp","custom_unit_amount":null,"livemode":false,"lookup_key":null,"metadata":[],"nickname":null,"product":"prod_Tak6nAbzZlgVAS","recurring":null,"tax_behavior":"unspecified","tiers_mode":null,"transform_quantity":null,"type":"one_time","unit_amount":2500,"unit_amount_decimal":"2500"},"unit_amount":2500,"custom_unit_amount":null,"variable":false,"maxPrice":null}]');
}
